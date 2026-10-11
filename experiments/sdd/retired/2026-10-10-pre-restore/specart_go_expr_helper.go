// specart_go_expr_helper is an experiment-side adapter for SpecArt's --expr
// helper protocol. It parses the Go-shaped expression subset used by Dpipe
// contracts; it does not execute target code or change validator decisions.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"strings"
)

type expr struct {
	text        string
	root        string
	start       int
	end         int
	fset        *token.FileSet
	ast         ast.Expr
	left, right *expr // SpecArt implication operator (~>).
}

type position struct {
	Line      int `json:"line"`
	Column    int `json:"column"`
	EndLine   int `json:"end_line"`
	EndColumn int `json:"end_column"`
}

type callInfo struct {
	Name          string   `json:"name"`
	ArgumentCount int      `json:"argument_count"`
	Arguments     []string `json:"arguments"`
	Source        string   `json:"source"`
	Position      position `json:"position"`
}

type memberInfo struct {
	Base     string   `json:"base"`
	Member   string   `json:"member"`
	Source   string   `json:"source"`
	Position position `json:"position"`
}

type referenceInfo struct {
	Name     string   `json:"name"`
	Position position `json:"position"`
}

type diagnostic struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
}

type output struct {
	SchemaVersion   int             `json:"schema_version"`
	Normalized      string          `json:"normalized"`
	ProofExpression any             `json:"proof_expression"`
	Position        *position       `json:"position"`
	Calls           []callInfo      `json:"calls"`
	References      []referenceInfo `json:"references"`
	MemberAccesses  []memberInfo    `json:"member_accesses"`
	Diagnostics     []diagnostic    `json:"diagnostics"`
}

func main() {
	if len(os.Args) != 3 || os.Args[1] != "--expr" {
		delegateFallback(os.Args[1:])
		return
	}
	source := os.Args[2]
	parsed, err := parseExpr(source, source, 0)
	if err != nil {
		writeJSON(output{SchemaVersion: 1, Calls: []callInfo{}, References: []referenceInfo{}, MemberAccesses: []memberInfo{}, Diagnostics: []diagnostic{{Code: "SA121", Message: err.Error(), Line: 1, Column: 1}}})
		os.Exit(1)
	}
	result := output{SchemaVersion: 1, Normalized: parsed.normalized(), ProofExpression: parsed.proof(),
		Position: ptr(parsed.position()), Calls: []callInfo{}, References: []referenceInfo{}, MemberAccesses: []memberInfo{}, Diagnostics: []diagnostic{}}
	parsed.collect(&result)
	writeJSON(result)
}

// Preserve the original helper for non-expression modes. Dpipe rounds do not
// parse Cangjie source, but this makes the adapter safe to coexist with the
// original helper when both are present in a run-scoped environment.
func delegateFallback(args []string) {
	fallback := os.Getenv("SPECART_AST_HELPER_FALLBACK")
	if fallback == "" {
		writeJSON(output{SchemaVersion: 1, Calls: []callInfo{}, References: []referenceInfo{}, MemberAccesses: []memberInfo{}, Diagnostics: []diagnostic{{Code: "SA101", Message: "non-expression helper mode requires SPECART_AST_HELPER_FALLBACK", Line: 1, Column: 1}}})
		os.Exit(2)
	}
	command := exec.Command(fallback, args...)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func ptr(p position) *position { return &p }

// parseExpr splits only SpecArt's top-level implication operator. The operands
// are parsed by Go's standard parser, so malformed or non-Go constructs fail
// closed rather than producing an empty successful AST.
func parseExpr(source, root string, base int) (*expr, error) {
	if at := topLevelImplication(source); at >= 0 {
		leftText, rightText := strings.TrimSpace(source[:at]), strings.TrimSpace(source[at+2:])
		if leftText == "" || rightText == "" {
			return nil, fmt.Errorf("incomplete ~> implication")
		}
		leftStart := base + strings.Index(source[:at], leftText)
		rightStart := base + at + 2 + strings.Index(source[at+2:], rightText)
		left, err := parseExpr(leftText, root, leftStart)
		if err != nil {
			return nil, err
		}
		right, err := parseExpr(rightText, root, rightStart)
		if err != nil {
			return nil, err
		}
		return &expr{text: source, root: root, start: base, end: base + len(source), left: left, right: right}, nil
	}
	fset := token.NewFileSet()
	node, err := parser.ParseExprFrom(fset, "contract.go", source, parser.AllErrors|parser.ParseComments)
	if err != nil {
		return nil, err
	}
	return &expr{text: source, root: root, start: base, end: base + len(source), fset: fset, ast: node}, nil
}

func topLevelImplication(source string) int {
	var parens, brackets, braces int
	var quote byte
	escaped := false
	for i := 0; i+1 < len(source); i++ {
		c := source[i]
		if quote != 0 {
			if quote != '`' && escaped {
				escaped = false
				continue
			}
			if quote != '`' && c == '\\' {
				escaped = true
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			quote = c
			continue
		}
		switch c {
		case '(':
			parens++
		case ')':
			parens--
		case '[':
			brackets++
		case ']':
			brackets--
		case '{':
			braces++
		case '}':
			braces--
		}
		if c == '~' && source[i+1] == '>' && parens == 0 && brackets == 0 && braces == 0 {
			return i
		}
	}
	return -1
}

func (e *expr) normalized() string {
	if e.left != nil {
		return e.left.normalized() + " ~> " + e.right.normalized()
	}
	var buffer bytes.Buffer
	if err := format.Node(&buffer, e.fset, e.ast); err != nil {
		return e.text
	}
	return buffer.String()
}

func (e *expr) position() position {
	if e.ast != nil && e.fset != nil {
		return e.nodePosition(e.ast.Pos(), e.ast.End())
	}
	return globalPosition(e.root, e.start, e.end)
}

func lineColumn(source string, offset int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if offset > len(source) {
		offset = len(source)
	}
	line, column := 1, 1
	for _, r := range source[:offset] {
		if r == '\n' {
			line++
			column = 1
		} else {
			column++
		}
	}
	return line, column
}

func globalPosition(source string, start, end int) position {
	startLine, startColumn := lineColumn(source, start)
	endLine, endColumn := lineColumn(source, end)
	return position{Line: startLine, Column: startColumn, EndLine: endLine, EndColumn: endColumn}
}

func (e *expr) proof() map[string]any {
	p := e.position()
	if e.left != nil {
		return map[string]any{"kind": "binary", "operator": "~>", "left": e.left.proof(), "right": e.right.proof(), "source": e.normalized(), "position": p}
	}
	source := e.normalized()
	base := map[string]any{"source": source, "position": p}
	switch n := e.ast.(type) {
	case *ast.BasicLit:
		base["kind"], base["value"] = "literal", n.Value
	case *ast.Ident:
		base["kind"], base["name"] = "ref", n.Name
	case *ast.SelectorExpr:
		base["kind"], base["base"], base["member"] = "member", proofFor(n.X, e.fset, e.root, e.start), n.Sel.Name
	case *ast.BinaryExpr:
		base["kind"], base["operator"], base["left"], base["right"] = "binary", n.Op.String(), proofFor(n.X, e.fset, e.root, e.start), proofFor(n.Y, e.fset, e.root, e.start)
	case *ast.UnaryExpr:
		base["kind"], base["operator"], base["operand"] = "unary", n.Op.String(), proofFor(n.X, e.fset, e.root, e.start)
	case *ast.ParenExpr:
		base["kind"], base["expression"] = "paren", proofFor(n.X, e.fset, e.root, e.start)
	case *ast.CallExpr:
		args := make([]any, 0, len(n.Args))
		for _, arg := range n.Args {
			args = append(args, proofFor(arg, e.fset, e.root, e.start))
		}
		base["kind"], base["callee"], base["arguments"] = "call", proofFor(n.Fun, e.fset, e.root, e.start), args
	default:
		base["kind"] = "unsupported"
	}
	return base
}

func proofFor(node ast.Expr, fset *token.FileSet, root string, baseOffset int) map[string]any {
	start, end := fset.Position(node.Pos()), fset.Position(node.End())
	p := globalPosition(root, baseOffset+start.Offset, baseOffset+end.Offset)
	source := formatNode(fset, node)
	base := map[string]any{"source": source, "position": p}
	switch n := node.(type) {
	case *ast.BasicLit:
		base["kind"], base["value"] = "literal", n.Value
	case *ast.Ident:
		base["kind"], base["name"] = "ref", n.Name
	case *ast.SelectorExpr:
		base["kind"], base["base"], base["member"] = "member", proofFor(n.X, fset, root, baseOffset), n.Sel.Name
	case *ast.BinaryExpr:
		base["kind"], base["operator"], base["left"], base["right"] = "binary", n.Op.String(), proofFor(n.X, fset, root, baseOffset), proofFor(n.Y, fset, root, baseOffset)
	case *ast.UnaryExpr:
		base["kind"], base["operator"], base["operand"] = "unary", n.Op.String(), proofFor(n.X, fset, root, baseOffset)
	case *ast.ParenExpr:
		base["kind"], base["expression"] = "paren", proofFor(n.X, fset, root, baseOffset)
	case *ast.CallExpr:
		args := make([]any, 0, len(n.Args))
		for _, arg := range n.Args {
			args = append(args, proofFor(arg, fset, root, baseOffset))
		}
		base["kind"], base["callee"], base["arguments"] = "call", proofFor(n.Fun, fset, root, baseOffset), args
	default:
		base["kind"] = "unsupported"
	}
	return base
}

func formatNode(fset *token.FileSet, node ast.Node) string {
	var buffer bytes.Buffer
	if err := format.Node(&buffer, fset, node); err != nil {
		return ""
	}
	return buffer.String()
}

func (e *expr) collect(out *output) {
	if e.left != nil {
		e.left.collect(out)
		e.right.collect(out)
		return
	}
	ast.Inspect(e.ast, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.CallExpr:
			args := make([]string, 0, len(n.Args))
			for _, arg := range n.Args {
				args = append(args, formatNode(e.fset, arg))
			}
			out.Calls = append(out.Calls, callInfo{Name: formatNode(e.fset, n.Fun), ArgumentCount: len(n.Args), Arguments: args, Source: formatNode(e.fset, n), Position: e.nodePosition(n.Pos(), n.End())})
		case *ast.SelectorExpr:
			out.MemberAccesses = append(out.MemberAccesses, memberInfo{Base: formatNode(e.fset, n.X), Member: n.Sel.Name, Source: formatNode(e.fset, n), Position: e.nodePosition(n.Pos(), n.End())})
		case *ast.Ident:
			// In Go's AST selector names are identifiers too; SpecArt represents
			// the member name on MemberAccess, not as a separate reference.
			if parent, ok := parentSelector(e.ast, n); ok && parent.Sel == n {
				return true
			}
			out.References = append(out.References, referenceInfo{Name: n.Name, Position: e.nodePosition(n.Pos(), n.End())})
		}
		return true
	})
}

func parentSelector(root ast.Node, target *ast.Ident) (*ast.SelectorExpr, bool) {
	var found *ast.SelectorExpr
	ast.Inspect(root, func(node ast.Node) bool {
		if selector, ok := node.(*ast.SelectorExpr); ok && selector.Sel == target {
			found = selector
			return false
		}
		return found == nil
	})
	return found, found != nil
}

func (e *expr) nodePosition(start, end token.Pos) position {
	a, b := e.fset.Position(start), e.fset.Position(end)
	return globalPosition(e.root, e.start+a.Offset, e.start+b.Offset)
}

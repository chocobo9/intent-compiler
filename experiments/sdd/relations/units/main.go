// Command units lists the code units of a Go source tree as JSON (relation record, v7 0.2): functions, dispatch
// branches (a switch case on a string literal) and literal slots (a string key of a map literal), each with the
// string literals it holds and its source text with whitespace collapsed. Read-only; standard library only.
//
// Usage: units <dir>   (writes a JSON array to stdout; _test.go files are skipped)
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

type unit struct {
	ID      string   `json:"id"`
	Kind    string   `json:"kind"`
	Func    string   `json:"func"`
	File    string   `json:"file"`
	Line    int      `json:"line"`
	End     int      `json:"end"`
	Hash    string   `json:"hash"`
	Strings []string `json:"strings"`
	Src     string   `json:"src"`
}

func main() {
	root := os.Args[1]
	fset := token.NewFileSet()
	var out []unit
	files := []string{}
	filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && strings.HasSuffix(p, ".go") && !strings.HasSuffix(p, "_test.go") {
			files = append(files, p)
		}
		return nil
	})
	sort.Strings(files)
	for _, p := range files {
		src, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		f, err := parser.ParseFile(fset, p, src, parser.ParseComments)
		if err != nil {
			continue
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		text := func(n ast.Node) string {
			return strings.Join(strings.Fields(string(src[fset.Position(n.Pos()).Offset:fset.Position(n.End()).Offset])), " ")
		}
		add := func(id, kind, fn string, n ast.Node) {
			s := text(n)
			h := sha256.Sum256([]byte(s))
			out = append(out, unit{ID: id, Kind: kind, Func: fn, File: rel, Line: fset.Position(n.Pos()).Line, End: fset.Position(n.End()).Line,
				Hash: hex.EncodeToString(h[:8]), Strings: literals(n), Src: s})
		}
		// Map literals with string keys, under the name they are bound to (a variable, or the enclosing function).
		slots := func(fn string, n ast.Node) {
			ast.Inspect(n, func(x ast.Node) bool {
				var name string
				var values []ast.Expr
				switch v := x.(type) {
				case *ast.AssignStmt:
					if len(v.Lhs) == len(v.Rhs) {
						for i, l := range v.Lhs {
							if id, ok := l.(*ast.Ident); ok {
								name = id.Name
								values = append(values, v.Rhs[i])
							}
						}
					}
				case *ast.ValueSpec:
					for i, l := range v.Names {
						if i < len(v.Values) {
							name = l.Name
							values = append(values, v.Values[i])
						}
					}
				}
				for _, val := range values {
					lit, ok := val.(*ast.CompositeLit)
					if !ok {
						continue
					}
					if _, isMap := lit.Type.(*ast.MapType); !isMap {
						continue
					}
					for _, e := range lit.Elts {
						kv, ok := e.(*ast.KeyValueExpr)
						if !ok {
							continue
						}
						if key, ok := kv.Key.(*ast.BasicLit); ok && key.Kind == token.STRING {
							k, _ := strconv.Unquote(key.Value)
							add("lit:"+fn+":"+name+"["+strconv.Quote(k)+"]", "slot", fn, kv)
						}
					}
				}
				return true
			})
		}
		for _, d := range f.Decls {
			switch v := d.(type) {
			case *ast.FuncDecl:
				fn := v.Name.Name
				if v.Recv != nil && len(v.Recv.List) > 0 {
					fn = recv(v.Recv.List[0].Type) + "." + fn
				}
				add("func:"+fn, "func", fn, v)
				if v.Body == nil {
					continue
				}
				ast.Inspect(v.Body, func(x ast.Node) bool {
					sw, ok := x.(*ast.SwitchStmt)
					if !ok {
						return true
					}
					for _, c := range sw.Body.List {
						cc := c.(*ast.CaseClause)
						for _, e := range cc.List {
							if b, ok := e.(*ast.BasicLit); ok && b.Kind == token.STRING {
								k, _ := strconv.Unquote(b.Value)
								add("case:"+fn+":"+k, "case", fn, cc)
							}
						}
					}
					return true
				})
				slots(fn, v.Body)
			case *ast.GenDecl:
				slots("pkg", v)
				for _, s := range v.Specs {
					ts, ok := s.(*ast.TypeSpec)
					if !ok {
						continue
					}
					if st, ok := ts.Type.(*ast.StructType); ok {
						u := unit{ID: "type:" + ts.Name.Name, Kind: "type", Func: ts.Name.Name, File: rel, Line: fset.Position(ts.Pos()).Line, End: fset.Position(ts.End()).Line}
						for _, fld := range st.Fields.List {
							if fld.Tag != nil {
								tag, _ := strconv.Unquote(fld.Tag.Value)
								if j := reflect.StructTag(tag).Get("json"); j != "" && j != "-" {
									u.Strings = append(u.Strings, strings.Split(j, ",")[0])
								}
							}
						}
						u.Src = text(ts)
						h := sha256.Sum256([]byte(u.Src))
						u.Hash = hex.EncodeToString(h[:8])
						out = append(out, u)
					}
				}
			}
		}
	}
	if out == nil {
		out = []unit{}
	}
	json.NewEncoder(os.Stdout).Encode(out)
}

func recv(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.StarExpr:
		return recv(t.X)
	case *ast.Ident:
		return t.Name
	case *ast.IndexExpr:
		return recv(t.X)
	}
	return "?"
}

// literals: the string literals a node holds, unquoted, in order, without repeats.
func literals(n ast.Node) []string {
	seen := map[string]bool{}
	out := []string{}
	ast.Inspect(n, func(x ast.Node) bool {
		if b, ok := x.(*ast.BasicLit); ok && b.Kind == token.STRING {
			if s, err := strconv.Unquote(b.Value); err == nil && !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
		return true
	})
	return out
}

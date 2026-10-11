// SpecArt's source-only Go adapter. It never loads or executes project code.
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
	"strconv"
	"strings"
)

type record = map[string]any
type reader struct {
	fs  *token.FileSet
	src []byte
}

// Expand grouped names for identity comparison while preserving names, types,
// order, receivers and variadic markers. Source text and contracts stay intact.
func canonicalSignature(sig string) string {
	method := !strings.HasPrefix(strings.TrimSpace(sig), "func ")
	text := sig
	if method {
		text = "func " + text
	}
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, "signature.go", "package p\n"+text, 0)
	if err != nil {
		panic(err)
	}
	decl := file.Decls[0].(*ast.FuncDecl)
	ast.Inspect(decl, func(node ast.Node) bool {
		fn, ok := node.(*ast.FuncType)
		if !ok {
			return true
		}
		for _, fields := range []*ast.FieldList{fn.TypeParams, fn.Params, fn.Results} {
			if fields == nil {
				continue
			}
			expanded := []*ast.Field{}
			for _, field := range fields.List {
				if len(field.Names) < 2 {
					expanded = append(expanded, field)
					continue
				}
				for _, name := range field.Names {
					copy := *field
					copy.Names = []*ast.Ident{name}
					expanded = append(expanded, &copy)
				}
			}
			fields.List = expanded
		}
		return true
	})
	var out bytes.Buffer
	if err := format.Node(&out, fs, decl); err != nil {
		panic(err)
	}
	result := strings.TrimSpace(out.String())
	if method {
		result = strings.TrimPrefix(result, "func ")
	}
	return result
}

func (r reader) text(n ast.Node) string {
	if n == nil {
		return ""
	}
	return string(r.src[r.fs.Position(n.Pos()).Offset:r.fs.Position(n.End()).Offset])
}
func (r reader) position(n ast.Node) record {
	p, e := r.fs.Position(n.Pos()), r.fs.Position(n.End())
	return record{"line": p.Line, "column": p.Column, "end_line": e.Line, "end_column": e.Column}
}
func modifiers(name string) []string {
	if ast.IsExported(name) {
		return []string{"public"}
	}
	return []string{"private"}
}
func (r reader) values(fields *ast.FieldList) []record {
	out := []record{}
	if fields == nil {
		return out
	}
	for _, f := range fields.List {
		if len(f.Names) == 0 {
			out = append(out, record{"name": "", "type": r.text(f.Type)})
			continue
		}
		for _, name := range f.Names {
			out = append(out, record{"name": name.Name, "type": r.text(f.Type)})
		}
	}
	return out
}
func (r reader) function(name string, typ *ast.FuncType, node ast.Node, body *ast.BlockStmt) record {
	returns := r.values(typ.Results)
	types := []string{}
	for _, v := range returns {
		types = append(types, v["type"].(string))
	}
	ret := ""
	if len(types) == 1 {
		ret = types[0]
	} else if len(types) > 1 {
		ret = "(" + strings.Join(types, ", ") + ")"
	}
	source := r.text(node)
	sig := source
	bodyText := ""
	count := 0
	locals := []record{}
	if body != nil {
		sig = string(r.src[r.fs.Position(node.Pos()).Offset:r.fs.Position(body.Pos()).Offset])
		bodyText = r.text(body)
		count = len(body.List)
		ast.Inspect(body, func(n ast.Node) bool {
			switch v := n.(type) {
			case *ast.ValueSpec:
				t := ""
				if v.Type != nil {
					t = r.text(v.Type)
				}
				for _, id := range v.Names {
					locals = append(locals, record{"name": id.Name, "type": t})
				}
			case *ast.AssignStmt:
				if v.Tok == token.DEFINE {
					for _, expr := range v.Lhs {
						if id, ok := expr.(*ast.Ident); ok {
							locals = append(locals, record{"name": id.Name, "type": ""})
						}
					}
				}
			}
			return true
		})
	}
	return record{"kind": "function", "name": name, "modifiers": modifiers(name), "parameters": r.values(typ.Params),
		"return_type": ret, "return_values": returns, "source": source, "signature": canonicalSignature(sig),
		"body": bodyText, "body_present": body != nil, "body_statement_count": count, "abstract": false,
		"position": r.position(node), "locals": locals}
}
func receiverName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return receiverName(t.X)
	case *ast.IndexExpr:
		return receiverName(t.X)
	case *ast.IndexListExpr:
		return receiverName(t.X)
	case *ast.SelectorExpr:
		return t.Sel.Name
	}
	return ""
}
func (r reader) members(fields *ast.FieldList, iface bool) []record {
	out := []record{}
	for _, field := range fields.List {
		if fn, ok := field.Type.(*ast.FuncType); ok && iface && len(field.Names) == 1 {
			rec := r.function(field.Names[0].Name, fn, field, nil)
			rec["abstract"] = true
			out = append(out, rec)
			continue
		}
		names := field.Names
		if len(names) == 0 {
			name := receiverName(field.Type)
			if name == "" {
				name = r.text(field.Type)
			}
			names = []*ast.Ident{{Name: name}}
		}
		// Each field name is addressable; the complete grouped signature stays protected.
		for _, n := range names {
			out = append(out, record{"kind": "field", "name": n.Name, "type": r.text(field.Type),
				"modifiers": modifiers(n.Name), "source": r.text(field), "signature": r.text(field), "position": r.position(field)})
		}
	}
	return out
}
func (r reader) typeRecord(t *ast.TypeSpec) record {
	rec := record{"kind": "declaration", "name": t.Name.Name, "modifiers": modifiers(t.Name.Name),
		"source": "type " + r.text(t), "signature": "type " + r.text(t), "position": r.position(t)}
	var fields *ast.FieldList
	var brace token.Pos
	switch typ := t.Type.(type) {
	case *ast.StructType:
		fields = typ.Fields
		brace = typ.Fields.Opening
		rec["kind"] = "struct"
	case *ast.InterfaceType:
		fields = typ.Methods
		brace = typ.Methods.Opening
		rec["kind"] = "interface"
	}
	if fields != nil {
		rec["signature"] = strings.TrimSpace("type " + string(r.src[r.fs.Position(t.Pos()).Offset:r.fs.Position(brace).Offset]))
		rec["members"] = r.members(fields, rec["kind"] == "interface")
	}
	return rec
}
func main() {
	args := os.Args[1:]
	fragment := len(args) == 2 && args[0] == "--declaration"
	if fragment {
		args = args[1:]
	}
	if len(args) != 1 {
		fail("", "expected [--declaration] source.go")
	}
	path := args[0]
	src, err := os.ReadFile(path)
	if err != nil {
		fail(path, err.Error())
	}
	if fragment {
		src = append([]byte("package specart_fragment\n"), src...)
	}
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, path, src, parser.ParseComments|parser.AllErrors)
	if err != nil {
		fail(path, err.Error())
	}
	r := reader{fs, src}
	decls := []record{}
	imports := []record{}
	comments := []record{}
	for _, group := range file.Comments {
		for _, c := range group.List {
			p := fs.Position(c.Pos())
			comments = append(comments, record{"value": c.Text, "line": p.Line, "column": p.Column})
		}
	}
	for _, imp := range file.Imports {
		value, e := strconv.Unquote(imp.Path.Value)
		if e != nil {
			fail(path, e.Error())
		}
		imports = append(imports, record{"package": value, "position": r.position(imp)})
	}
	for _, d := range file.Decls {
		switch n := d.(type) {
		case *ast.FuncDecl:
			rec := r.function(n.Name.Name, n.Type, n, n.Body)
			if n.Recv != nil {
				if len(n.Recv.List) != 1 || len(n.Recv.List[0].Names) > 1 {
					fail(path, "method must have exactly one receiver")
				}
				owner := receiverName(n.Recv.List[0].Type)
				if owner == "" {
					fail(path, "unsupported receiver type")
				}
				rec["owner"] = owner
				rec["receiver"] = r.values(n.Recv)[0]
			}
			decls = append(decls, rec)
		case *ast.GenDecl:
			if n.Tok == token.IMPORT {
				continue
			}
			if n.Tok == token.TYPE {
				for _, spec := range n.Specs {
					t := spec.(*ast.TypeSpec)
					rec := r.typeRecord(t)
					if len(n.Specs) == 1 && !n.Lparen.IsValid() {
						rec["position"] = r.position(n)
					}
					decls = append(decls, rec)
				}
			} else {
				names := []string{}
				bodies := []string{}
				ast.Inspect(n, func(node ast.Node) bool {
					if fn, ok := node.(*ast.FuncLit); ok {
						bodies = append(bodies, r.text(fn.Body))
						return false
					}
					return true
				})
				for _, s := range n.Specs {
					for _, id := range s.(*ast.ValueSpec).Names {
						names = append(names, id.Name)
					}
				}
				decls = append(decls, record{"kind": "declaration", "name": strings.Join(names, ","), "source": r.text(n), "signature": r.text(n),
					"position": r.position(n), "implementation_bodies": bodies, "modifiers": []string{}})
			}
		default:
			fail(path, "unsupported declaration")
		}
	}
	json.NewEncoder(os.Stdout).Encode(record{"schema_version": 1, "package": file.Name.Name, "declarations": decls, "imports": imports, "comments": comments, "diagnostics": []record{}})
}
func fail(path, message string) {
	json.NewEncoder(os.Stdout).Encode(record{"schema_version": 1, "diagnostics": []record{{"code": "SA103", "file": path, "message": message}}})
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}

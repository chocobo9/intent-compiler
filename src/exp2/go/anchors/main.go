// Command anchors prints the code anchors of a Go source tree as JSON (exp2 DESIGN §3, §7): files, functions and
// methods, types, and dispatch points (string case labels of switch statements, string keys of map literals).
// Each anchor carries its line range and a hash of its source text, so a change to it shows as a changed hash.
//
// Usage: anchors <dir>
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type anchor struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	File  string `json:"file"`
	Start int    `json:"start_line"`
	End   int    `json:"end_line"`
	Hash  string `json:"hash"`
}

func digest(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])[:12]
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: anchors <dir>")
		os.Exit(2)
	}
	root := os.Args[1]
	var out []anchor
	seen := map[string]int{}
	add := func(a anchor) {
		base := fmt.Sprintf("A:%s:%s:%s", a.File, a.Kind, a.Name)
		seen[base]++
		a.ID = base
		if n := seen[base]; n > 1 {
			a.ID = fmt.Sprintf("%s#%d", base, n)
		}
		out = append(out, a)
	}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if path != root && (strings.HasPrefix(name, ".") || name == "vendor" || name == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(name, ".go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, src, parser.SkipObjectResolution)
		lines := strings.Count(string(src), "\n") + 1
		add(anchor{Kind: "file", Name: rel, File: rel, Start: 1, End: lines, Hash: digest(src)})
		if err != nil {
			// An unparsable file is still a file anchor; its inner anchors are unknown.
			return nil
		}
		span := func(n ast.Node) (int, int, string) {
			s, e := fset.Position(n.Pos()), fset.Position(n.End())
			return s.Line, e.Line, digest(src[s.Offset:e.Offset])
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.FuncDecl:
				fn := x.Name.Name
				if x.Recv != nil && len(x.Recv.List) > 0 {
					t := x.Recv.List[0].Type
					if st, ok := t.(*ast.StarExpr); ok {
						t = st.X
					}
					if id, ok := t.(*ast.Ident); ok {
						fn = id.Name + "." + fn
					}
				}
				s, e, h := span(x)
				add(anchor{Kind: "func", Name: fn, File: rel, Start: s, End: e, Hash: h})
			case *ast.TypeSpec:
				s, e, h := span(x)
				add(anchor{Kind: "type", Name: x.Name.Name, File: rel, Start: s, End: e, Hash: h})
			case *ast.CaseClause:
				for _, v := range x.List {
					if lit, ok := v.(*ast.BasicLit); ok && lit.Kind == token.STRING {
						if val, err := strconv.Unquote(lit.Value); err == nil {
							s, e, h := span(x)
							add(anchor{Kind: "dispatch", Name: val, File: rel, Start: s, End: e, Hash: h})
						}
					}
				}
			case *ast.CompositeLit:
				if _, ok := x.Type.(*ast.MapType); ok {
					for _, el := range x.Elts {
						if kv, ok := el.(*ast.KeyValueExpr); ok {
							if lit, ok := kv.Key.(*ast.BasicLit); ok && lit.Kind == token.STRING {
								if val, err := strconv.Unquote(lit.Value); err == nil {
									s, e, h := span(kv)
									add(anchor{Kind: "dispatch", Name: val, File: rel, Start: s, End: e, Hash: h})
								}
							}
						}
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if out == nil {
		out = []anchor{}
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

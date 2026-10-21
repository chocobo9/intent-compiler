// Command mutate lists simple mechanical mutations of a Go source tree as JSON (exp2 DESIGN §12b item 13): a
// comparison operator swapped for its opposite, an integer constant plus or minus one, an if branch emptied.
// Each site is a byte range of one file and the text that replaces it; applying it is the caller's job.
// Test files and vendored code are skipped.
//
// Usage: mutate <dir>
package main

import (
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

type site struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	File  string `json:"file"`
	Line  int    `json:"line"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	From  string `json:"from"`
	To    string `json:"to"`
}

var opposite = map[token.Token]token.Token{
	token.EQL: token.NEQ, token.NEQ: token.EQL,
	token.LSS: token.GEQ, token.GEQ: token.LSS,
	token.GTR: token.LEQ, token.LEQ: token.GTR,
}

// A boundary moved by one: the classic mutant that only an input at the boundary itself tells apart.
var boundary = map[token.Token]token.Token{
	token.LSS: token.LEQ, token.LEQ: token.LSS,
	token.GTR: token.GEQ, token.GEQ: token.GTR,
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: mutate <dir>")
		os.Exit(2)
	}
	root := os.Args[1]
	sites := []site{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if name := d.Name(); path != root && (name == "vendor" || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			return nil // a file that does not parse has nothing to mutate
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		add := func(kind string, pos, end token.Pos, to string) {
			p, e := fset.Position(pos), fset.Position(end)
			sites = append(sites, site{Kind: kind, File: rel, Line: p.Line, Start: p.Offset, End: e.Offset, From: string(src[p.Offset:e.Offset]), To: to})
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.GenDecl:
				// Imports and constant declarations' types are not behaviour; constants' values are.
				if x.Tok == token.IMPORT {
					return false
				}
			case *ast.BinaryExpr:
				if to, ok := opposite[x.Op]; ok {
					add("compare", x.OpPos, x.OpPos+token.Pos(len(x.Op.String())), to.String())
				}
				if to, ok := boundary[x.Op]; ok {
					add("boundary", x.OpPos, x.OpPos+token.Pos(len(x.Op.String())), to.String())
				}
			case *ast.BasicLit:
				if x.Kind == token.INT {
					if v, err := strconv.ParseInt(x.Value, 0, 64); err == nil {
						add("constant", x.Pos(), x.End(), strconv.FormatInt(v+1, 10))
						add("constant", x.Pos(), x.End(), strconv.FormatInt(v-1, 10))
					}
				}
			case *ast.IfStmt:
				if len(x.Body.List) > 0 {
					add("branch", x.Body.Lbrace, x.Body.Rbrace+1, "{}")
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
	sort.SliceStable(sites, func(i, j int) bool {
		if sites[i].File != sites[j].File {
			return sites[i].File < sites[j].File
		}
		return sites[i].Start < sites[j].Start
	})
	for i := range sites {
		sites[i].ID = fmt.Sprintf("M%d", i+1)
	}
	out, _ := json.Marshal(sites)
	fmt.Println(string(out))
}

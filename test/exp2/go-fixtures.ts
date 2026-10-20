/**
 * Go source the stand-in executor writes: a slice of dpipe (verify; transform with filter, sort, drop, rename).
 * Pieces are whole files so that each step's edit is a plain file write.
 */

export const MAIN = `package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "ERROR: missing command")
		os.Exit(1)
	}
	args := parseFlags(os.Args[2:])
	switch os.Args[1] {
	case "verify":
		os.Exit(runVerify(args))
	case "transform":
		os.Exit(runTransform(args))
	default:
		fmt.Fprintln(os.Stderr, "ERROR: unknown command "+os.Args[1])
		os.Exit(1)
	}
}

func parseFlags(a []string) map[string]string {
	m := make(map[string]string)
	for i := 0; i+1 < len(a); i += 2 {
		m[a[i]] = a[i+1]
	}
	return m
}

func fail(msg string) int {
	fmt.Fprintln(os.Stderr, msg)
	return 1
}
`

export const VERIFY_STUB = `package main

func runVerify(args map[string]string) int { return fail("ERROR: not implemented") }
`

export const TRANSFORM_STUB = `package main

func runTransform(args map[string]string) int { return fail("ERROR: not implemented") }
`

export const VERIFY = (ok = "VERIFIED") => `package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

func runVerify(args map[string]string) int {
	data, err := os.ReadFile(args["--file"])
	if err != nil {
		return fail("ERROR: file not found: " + args["--file"])
	}
	want, err := os.ReadFile(args["--checksum"])
	if err != nil {
		return fail("ERROR: file not found: " + args["--checksum"])
	}
	sum := sha256.Sum256(data)
	got := hex.EncodeToString(sum[:])
	exp := strings.TrimSpace(string(want))
	if got == exp {
		fmt.Println("${ok}")
		return 0
	}
	fmt.Println("MISMATCH expected=" + exp + " actual=" + got)
	return 1
}
`

/** transform with the ops named in \`ops\` registered in its dispatch map. */
export const TRANSFORM = (ops: string[]) => `package main

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type table struct {
	header []string
	rows   [][]string
}

var ops = map[string]func(table, map[string]any) (table, error){
${ops.map(o => `\t"${o}": op${o[0].toUpperCase()}${o.slice(1)},`).join("\n")}
}

func runTransform(args map[string]string) int {
	_ = args["--seed"]
	in, err := os.ReadFile(args["--input"])
	if err != nil {
		return fail("ERROR: file not found: " + args["--input"])
	}
	rb, err := os.ReadFile(args["--recipe"])
	if err != nil {
		return fail("ERROR: file not found: " + args["--recipe"])
	}
	var recipe []map[string]any
	if json.Unmarshal(rb, &recipe) != nil {
		return fail("ERROR: malformed JSON: " + args["--recipe"])
	}
	recs, err := csv.NewReader(strings.NewReader(string(in))).ReadAll()
	if err != nil || len(recs) == 0 {
		return fail("ERROR: cannot parse CSV: " + args["--input"])
	}
	t := table{recs[0], recs[1:]}
	for _, op := range recipe {
		name, _ := op["op"].(string)
		f, ok := ops[name]
		if !ok {
			return fail("ERROR: invalid recipe: unknown op " + name)
		}
		if t, err = f(t, op); err != nil {
			return fail(err.Error())
		}
	}
	var b strings.Builder
	w := csv.NewWriter(&b)
	w.Write(t.header)
	w.WriteAll(t.rows)
	w.Flush()
	os.WriteFile(args["--output"], []byte(b.String()), 0o644)
	sum := sha256.Sum256([]byte(b.String()))
	os.WriteFile(args["--output"]+".sha256", []byte(hex.EncodeToString(sum[:])+"\\n"), 0o644)
	return 0
}

func col(t table, name string) (int, error) {
	for i, h := range t.header {
		if h == name {
			return i, nil
		}
	}
	return -1, fmt.Errorf("ERROR: invalid recipe: column %s not found", name)
}
`

/** filter; \`wrong\` keeps the rows the condition rejects. */
export const FILTER = (wrong = false) => `package main

import "strconv"

func opFilter(t table, op map[string]any) (table, error) {
	c, _ := op["column"].(string)
	i, err := col(t, c)
	if err != nil {
		return t, err
	}
	th, _ := op["threshold"].(float64)
	cond, _ := op["condition"].(string)
	out := table{header: t.header}
	for _, r := range t.rows {
		v, err := strconv.ParseFloat(r[i], 64)
		if err != nil {
			continue
		}
		keep := false
		switch cond {
		case "gt":
			keep = v > th
		case "gte":
			keep = v >= th
		case "lt":
			keep = v < th
		case "lte":
			keep = v <= th
		case "eq":
			keep = v == th
		case "neq":
			keep = v != th
		}
		if keep != ${wrong ? "true" : "false"} {
			out.rows = append(out.rows, r)
		}
	}
	return out, nil
}
`

export const SORT = `package main

import "sort"

func opSort(t table, op map[string]any) (table, error) {
	c, _ := op["column"].(string)
	i, err := col(t, c)
	if err != nil {
		return t, err
	}
	desc := op["order"] == "desc"
	sort.SliceStable(t.rows, func(a, b int) bool {
		if desc {
			return t.rows[a][i] > t.rows[b][i]
		}
		return t.rows[a][i] < t.rows[b][i]
	})
	return t, nil
}
`

export const DROP = `package main

func opDrop(t table, op map[string]any) (table, error) {
	cols, _ := op["columns"].([]any)
	gone := map[int]bool{}
	for _, c := range cols {
		name, _ := c.(string)
		i, err := col(t, name)
		if err != nil {
			return t, err
		}
		gone[i] = true
	}
	keep := func(r []string) []string {
		out := []string{}
		for i, v := range r {
			if !gone[i] {
				out = append(out, v)
			}
		}
		return out
	}
	res := table{header: keep(t.header)}
	for _, r := range t.rows {
		res.rows = append(res.rows, keep(r))
	}
	return res, nil
}
`

export const RENAME = `package main

func opRename(t table, op map[string]any) (table, error) {
	from, _ := op["from"].(string)
	to, _ := op["to"].(string)
	i, err := col(t, from)
	if err != nil {
		return t, err
	}
	t.header[i] = to
	return t, nil
}
`

export const GO_MOD = "module dpipe\n\ngo 1.22\n"

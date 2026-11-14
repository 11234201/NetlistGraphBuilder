"""Focused semantic and permutation checks for the research import adapters."""

import copy
import itertools
import json
from pathlib import Path
import random
import sys
import unittest

from aig_input import analyze, display_dot, normalize, parse_abc_dot, parse_blif


FIXTURES = Path(sys.argv.pop(1))
DOT = (FIXTURES / "abc_input.dot").read_text()
BLIF = (FIXTURES / "abc_input.blif").read_text()


def model_from_blif(text):
    return normalize(parse_blif(text))[0]


def evaluate_model(model, values):
    signals, outputs = {}, {}
    fanins = {node["id"]: [] for node in model["nodes"]}
    for edge in model["edges"]:
        fanins[edge["target"]].append(edge)
    for node in model["nodes"]:
        kind = node["kind"]
        if kind == "pi":
            signals[node["id"]] = values[node["label"]]
        elif kind == "constant":
            signals[node["id"]] = False
        elif kind == "and":
            signals[node["id"]] = all(signals[edge["source"]] ^ edge["inverted"]
                                      for edge in fanins[node["id"]])
        else:
            edge, = fanins[node["id"]]
            outputs[node["label"]] = signals[edge["source"]] ^ edge["inverted"]
    return outputs


def evaluate_aag(text, values):
    lines = text.splitlines()
    _, maximum, inputs, latches, outputs, gates = lines[0].split()
    inputs, outputs, gates = int(inputs), int(outputs), int(gates)
    assert int(latches) == 0
    symbol_start = 1 + inputs + outputs + gates
    symbols = {}
    for line in lines[symbol_start:]:
        if line == "c":
            break
        key, name = line.split(" ", 1)
        symbols[key] = name
    signals = {0: False}
    def literal_value(literal):
        return signals[literal // 2] ^ bool(literal & 1)
    for index in range(inputs):
        signals[int(lines[index + 1]) // 2] = values[symbols[f"i{index}"]]
    for line in lines[1 + inputs + outputs:symbol_start]:
        lhs, left, right = map(int, line.split())
        signals[lhs // 2] = literal_value(left) and literal_value(right)
    return {symbols[f"o{index}"]: literal_value(int(lines[1 + inputs + index]))
            for index in range(outputs)}


class InputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dot_raw = parse_abc_dot(DOT)
        cls.model, _ = normalize(cls.dot_raw)

    def test_same_names_structure_and_analysis(self):
        actual = model_from_blif(BLIF)
        self.assertEqual(actual, self.model)
        self.assertEqual(display_dot(actual), display_dot(self.model))
        self.assertEqual(analyze(actual), analyze(self.model))
        self.assertEqual({n["label"] for n in actual["nodes"] if n["kind"] == "pi"},
                         {"a", "b", "c", "d"})
        self.assertEqual({n["label"] for n in actual["nodes"] if n["kind"] == "po"},
                         {"y", "shared", "masked"})
        self.assertEqual((len(actual["nodes"]), len(actual["edges"]),
                          sum(edge["inverted"] for edge in actual["edges"])), (15, 19, 10))

    def test_all_sixteen_truth_assignments_against_original_aag(self):
        aag = (FIXTURES / "shared_cone.aag").read_text()
        for bits in itertools.product((False, True), repeat=4):
            values = dict(zip("abcd", bits))
            expected = evaluate_aag(aag, values)
            self.assertEqual(evaluate_model(self.model, values), expected)
            self.assertEqual(evaluate_model(model_from_blif(BLIF), values), expected)

    def test_inputs_are_not_mutated(self):
        for raw in [parse_abc_dot(DOT), parse_blif(BLIF)]:
            snapshot = copy.deepcopy(raw)
            normalize(raw)
            self.assertEqual(raw, snapshot)

    def test_blif_order_and_fanin_permutations(self):
        original = parse_blif(BLIF)
        tables = [item for item in original["nodes"].values() if item["kind"] == "table"]
        for seed in range(12):
            rng = random.Random(seed)
            items = copy.deepcopy(tables)
            rng.shuffle(items)
            pis, pos = list("abcd"), ["y", "shared", "masked"]
            rng.shuffle(pis)
            rng.shuffle(pos)
            lines = [".model reordered", ".inputs " + " ".join(pis), ".outputs " + " ".join(pos)]
            # Every internal identifier changes, so no source-name ordering can pass accidentally.
            rename = {item["label"]: f"gate_{seed}_{index}" for index, item in enumerate(items)
                      if item["label"] not in pos}
            for item in items:
                reverse = rng.choice([False, True])
                fanins = item["inputs"][::-1] if reverse else item["inputs"]
                lines.append(".names " + " ".join(rename.get(name, name)
                             for name in fanins + [item["label"]]))
                for row in item["rows"]:
                    cube = row[0][::-1] if reverse else row[0]
                    lines.append(" ".join([cube] + row[1:]))
            lines.append(".end")
            self.assertEqual(model_from_blif("\n".join(lines)), self.model)

    def test_dot_order_ids_and_display_settings_are_ignored(self):
        raw = self.dot_raw
        for seed in range(12):
            rng = random.Random(seed)
            items = list(raw["nodes"].items())
            rng.shuffle(items)
            rename = {key: f"changed_{index}" for index, (key, _) in enumerate(items)}
            lines = ['digraph changed {rankdir=LR; size="99,99"; edge [dir=back];',
                     'helper [shape=plaintext,label="unrelated title"];']
            edges = []
            for key, item in items:
                shape = {"pi": "triangle", "po": "invtriangle", "and": "ellipse",
                         "constant": "box"}[item["kind"]]
                lines.append(f'{rename[key]} [shape={shape},label={json.dumps(item["label"])}];')
                for child, inverted in item["fanins"]:
                    edges.append(f'{rename[key]} -> {rename[child]} '
                                 f'[style={"dotted" if inverted else "solid"}];')
            rng.shuffle(edges)
            lines.extend(edges)
            lines.append("}")
            self.assertEqual(normalize(parse_abc_dot("\n".join(lines)))[0], self.model)

    def test_explicit_not_and_buffer_chains(self):
        source = {node["id"]: node for node in self.model["nodes"]}
        incoming = {key: [] for key in source}
        for edge in self.model["edges"]:
            incoming[edge["target"]].append(edge)
        lines = [".model expanded", ".inputs a b c d", ".outputs y shared masked"]
        def net(key):
            node = source[key]
            return node["label"] if node["kind"] == "pi" else key
        for node in self.model["nodes"]:
            if node["kind"] == "pi":
                continue
            literals = []
            for edge in incoming[node["id"]]:
                name = net(edge["source"])
                if edge["inverted"]:
                    inverse = "not_" + edge["id"].replace(":", "_")
                    lines.extend([f".names {name} {inverse}", "0 1"])
                    name = inverse
                literals.append(name)
            if node["kind"] == "and":
                lines.extend([".names " + " ".join(literals + [node["id"]]), "11 1"])
            else:
                # Two positive aliases should not become visible BUF nodes.
                lines.extend([f'.names {literals[0]} buffer_{node["id"]}', "1 1",
                              f'.names buffer_{node["id"]} {node["label"]}', "1 1"])
        lines.append(".end")
        self.assertEqual(model_from_blif("\n".join(lines)), self.model)

    def test_repeated_fanin_slots_survive(self):
        model = model_from_blif(".model repeated\n.inputs a\n.outputs y\n.names a a y\n11 1\n.end")
        self.assertEqual(len(model["edges"]), 3)
        two = [edge for edge in model["edges"] if edge["target"].startswith("n")]
        self.assertEqual(len(two), 2)
        self.assertEqual(two[0]["source"], two[1]["source"])
        self.assertNotEqual(two[0]["id"], two[1]["id"])

    def test_constants_and_output_inversion(self):
        text = ".model c\n.inputs a\n.outputs zero one na\n.names zero\n.names one\n1\n.names a na\n0 1\n.end"
        model = model_from_blif(text)
        for bit in (False, True):
            self.assertEqual(evaluate_model(model, {"a": bit}),
                             dict(zero=False, one=True, na=not bit))

    def test_names_are_separate_from_ids_and_quoted(self):
        text = '.model labels\n.inputs a&b c\n.outputs y<0>\n.names a&b c y<0>\n11 1\n.end'
        model = model_from_blif(text)
        self.assertIn('label="a&b"', display_dot(model))
        self.assertIn('label="y<0>"', display_dot(model))
        self.assertTrue(all(n["id"] != n["label"] for n in model["nodes"]
                            if n["kind"] in ("pi", "po")))

    def test_invalid_or_out_of_scope_blif_is_rejected(self):
        bodies = [
            ".names missing b y\n11 1",
            ".names y b y\n11 1",
            ".names a b y\n01 1\n10 1",
            ".names a b y\n11 1\n.names a y\n1 1",
            ".gate AND2 A=a B=b Y=y",
            ".latch a y",
            ".subckt child a=a y=y",
        ]
        for body in bodies:
            with self.subTest(body=body), self.assertRaises(ValueError):
                model_from_blif(".model invalid\n.inputs a b\n.outputs y\n" + body + "\n.end")

    def test_duplicate_gates_are_not_silently_merged(self):
        text = ".model duplicates\n.inputs a b\n.outputs x y\n.names a b x\n11 1\n.names b a y\n11 1\n.end"
        with self.assertRaisesRegex(ValueError, "Duplicate structurally identical"):
            model_from_blif(text)

    def test_wrong_dot_direction_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "dir=back"):
            parse_abc_dot(DOT.replace("dir = back", "dir = forward"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

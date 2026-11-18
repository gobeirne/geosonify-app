"""Every core-profile vector decodes exactly as the reference decoder says."""
import json, math, os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'src'))
import geosonify_decode as G

VECTORS = os.path.join(HERE, '..', 'src', 'geosonify_decode', 'vectors.json')


def same(a, b, path='$'):
    if isinstance(a, float) or isinstance(b, float):
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, rel_tol=0, abs_tol=1e-12)):
            raise AssertionError('%s: %r != %r' % (path, a, b))
        return
    if isinstance(a, dict) and isinstance(b, dict):
        if sorted(a) != sorted(b):
            raise AssertionError('%s keys: %s != %s' % (path, sorted(a), sorted(b)))
        for k in a:
            same(a[k], b[k], path + '.' + str(k))
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            raise AssertionError('%s length: %d != %d' % (path, len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, '%s[%d]' % (path, i))
        return
    if a != b:
        raise AssertionError('%s: %r != %r' % (path, a, b))


class Vectors(unittest.TestCase):
    def test_all(self):
        with open(VECTORS, encoding='utf-8') as f:
            data = json.load(f)
        self.assertGreaterEqual(len(data['vectors']), 24)
        for v in data['vectors']:
            with self.subTest(link=v['link']):
                same(G.decode_link(v['link']), v['decoded'])
                same(G.parse_annotations(v['link']), v['annotations'])

    def test_refuses_outside_core(self):
        for q in ['b64o=v-dzcFN-', 'hphexj=9562528335F', 'enc=abc']:
            with self.assertRaises(ValueError):
                G.decode_link(q)


if __name__ == '__main__':
    unittest.main(verbosity=1)

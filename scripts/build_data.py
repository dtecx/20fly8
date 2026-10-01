# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pandas", "pyarrow"]
# ///
"""Download the FlyWire v783 connectome and cut out the fly's learning centre, the mushroom body.

Sources
  - Shiu et al. 2024 whole-brain model inputs (neuron order + signed connectivity):
    https://github.com/philshiu/Drosophila_brain_model
  - FlyWire cell-type annotations (Schlegel et al. 2024):
    https://github.com/flyconnectome/flywire_annotations

Output (public/data/)
  mb.json        the mushroom-body circuit: projection neurons (PN), Kenyon cells (KC), output neurons (MBON),
                 dopaminergic neurons (DAN), APL and DPM, with every synapse count between them
  brain.bin.gz   every neuron of the brain as a point, for context: anchor xyz int16 (0.25 um) | super-class u8

Raw downloads are cached outside the project: ~/.cache/20fly8 (override with FLYWIRE_CACHE). Files already
downloaded by doodle-fly (~/.cache/doodle-fly) are reused.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
CACHE = Path(os.environ.get("FLYWIRE_CACHE", Path.home() / ".cache" / "20fly8"))
SIBLING_CACHES = [Path.home() / ".cache" / "doodle-fly"]

SOURCES = {
    "Completeness_783.csv": "https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Completeness_783.csv",
    "Connectivity_783.parquet": "https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Connectivity_783.parquet",
    "Supplemental_file1_neuron_annotations.tsv": "https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv",
}

# a PN counts as an input channel of the mushroom body if it reaches at least this many Kenyon cells
MIN_PN_KC_PARTNERS = 5
POS_SCALE = 0.25  # um per int16 unit in brain.bin


def fetch(name: str) -> Path:
    path = CACHE / name
    if path.exists():
        return path
    for sib in SIBLING_CACHES:
        if (sib / name).exists():
            print(f"reusing {sib / name}", flush=True)
            return sib / name
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"downloading {name} ...", flush=True)
    tmp = path.with_suffix(path.suffix + ".part")
    urllib.request.urlretrieve(SOURCES[name], tmp)
    tmp.replace(path)
    return path


def main() -> None:
    comp = pd.read_csv(fetch("Completeness_783.csv"), index_col=0)
    con = pd.read_parquet(fetch("Connectivity_783.parquet"))
    ann = pd.read_csv(
        fetch("Supplemental_file1_neuron_annotations.tsv"),
        sep="\t",
        low_memory=False,
        dtype={"root_id": "int64", "supervoxel_id": "Int64"},
    )
    ann = ann.drop_duplicates("root_id").set_index("root_id")
    n = len(comp)
    a = ann.reindex(comp.index.to_numpy(dtype=np.int64))
    cls = a["cell_class"].fillna("").to_numpy(str)
    ctype = a["cell_type"].fillna("").to_numpy(str)
    nt = a["top_nt"].fillna("unknown").to_numpy(str)
    side = a["side"].map({"left": "L", "right": "R", "center": "C"}).fillna("?").to_numpy(str)
    voxel = np.array([4.0, 4.0, 40.0]) / 1000.0  # voxel -> micrometres
    anchor = a[["pos_x", "pos_y", "pos_z"]].to_numpy(float) * voxel
    soma = a[["soma_x", "soma_y", "soma_z"]].to_numpy(float) * voxel
    soma = np.where(np.isnan(soma), anchor, soma)
    centre = np.nanmean(anchor, axis=0)
    anchor = np.where(np.isnan(anchor), centre, anchor)
    soma = np.where(np.isnan(soma), centre, soma)

    pre = con["Presynaptic_Index"].to_numpy(np.int64)
    post = con["Postsynaptic_Index"].to_numpy(np.int64)
    w = con["Excitatory x Connectivity"].to_numpy(np.int64)
    print(f"neurons {n:,}  connections {len(con):,}")

    # --- populations -----------------------------------------------------------------------------
    is_kc = cls == "Kenyon_Cell"
    kc_partners = np.bincount(pre[is_kc[post]], minlength=n)
    is_pn = (cls == "ALPN") & (nt == "acetylcholine") & (kc_partners >= MIN_PN_KC_PARTNERS)
    is_mbon = cls == "MBON"
    is_dan = cls == "DAN"
    is_apl = ctype == "APL"
    is_dpm = ctype == "DPM"

    def ids(mask: np.ndarray) -> np.ndarray:
        # left side first, then right, then by index: a stable, readable order
        idx = np.flatnonzero(mask)
        order = np.lexsort((idx, np.array([{"L": 0, "R": 1}.get(s, 2) for s in side[idx]])))
        return idx[order]

    groups = {"pn": ids(is_pn), "kc": ids(is_kc), "mbon": ids(is_mbon), "dan": ids(is_dan), "apl": ids(is_apl), "dpm": ids(is_dpm)}
    local = {k: {int(g): i for i, g in enumerate(v)} for k, v in groups.items()}
    for k, v in groups.items():
        print(f"  {k:5s} {len(v):5d} neurons")

    def edges(src: str, dst: str) -> list[int]:
        m = np.isin(pre, groups[src]) & np.isin(post, groups[dst])
        out: list[int] = []
        ls, ld = local[src], local[dst]
        for p, q, s in zip(pre[m], post[m], w[m]):
            out += [ls[int(p)], ld[int(q)], int(s)]
        print(f"  {src}->{dst}: {len(out) // 3:,} connections, {int(np.abs(w[m]).sum()):,} synapses")
        return out

    def describe(key: str) -> dict:
        idx = groups[key]
        return {
            "id": idx.tolist(),
            "type": ctype[idx].tolist(),
            "side": "".join(side[idx]),
            "nt": nt[idx].tolist(),
            "pos": np.round(soma[idx], 1).ravel().tolist(),
        }

    circuit = {
        "version": 1,
        "dataset": "FlyWire FAFB v783",
        "neurons": n,
        "connections": int(len(con)),
        "synapses": int(np.abs(w).sum()),
        "minPnKcPartners": MIN_PN_KC_PARTNERS,
        "groups": {k: describe(k) for k in groups},
        "edges": {
            "pnKc": edges("pn", "kc"),
            "kcMbon": edges("kc", "mbon"),
            "danMbon": edges("dan", "mbon"),
            "mbonDan": edges("mbon", "dan"),
            "danKc": edges("dan", "kc"),
            "kcApl": edges("kc", "apl"),
            "aplKc": edges("apl", "kc"),
        },
        "sources": SOURCES,
    }

    # --- whole-brain point cloud (context only) ---------------------------------------------------------
    sc_names = ["unknown"] + sorted(set(a["super_class"].dropna().astype(str)))
    sc = a["super_class"].fillna("unknown").map({k: i for i, k in enumerate(sc_names)}).to_numpy(np.uint8)
    q = np.round((anchor - centre) / POS_SCALE).astype(np.int16)
    circuit["brain"] = {"file": "brain.bin.gz", "scale": POS_SCALE, "centre": np.round(centre, 2).tolist(), "superclasses": sc_names}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "mb.json").write_text(json.dumps(circuit, separators=(",", ":")))
    (OUT / "brain.bin.gz").write_bytes(gzip.compress(q.tobytes() + sc.tobytes(), compresslevel=9))
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:14s} {f.stat().st_size / 1e6:7.2f} MB")


if __name__ == "__main__":
    sys.exit(main())

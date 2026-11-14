Same-AIG visualization comparison
Run date: 2026-11-14. Execution host: mfs-remote (Linux).

Input and checks
- shared_cone.aag is the human-readable fixture.
- All three tools read exactly shared_cone.aig.
- 4 primary inputs, 8 AND nodes, 3 primary outputs, logic depth 4.
- Shared fanout, reconvergence, complemented internal edges and complemented outputs.
- No optimization passes were applied.
- Structural fingerprints and all 16 input assignments match between the AAG,
  binary input, ABC roundtrip, and native mockturtle roundtrip.
- AIGER/aigtodot draws the common input directly.
- Internal node numbers differ by tool; they are not cross-tool identifiers.
- manifest.json contains checks, input hash, source revisions/hashes and native image dimensions.

Native drawing commands (run in this directory)
  ./abc_build/abc -c "read_aiger shared_cone.aig; print_stats; write_dot abc.dot; write_aiger abc_roundtrip.aig"
  ./draw_aig shared_cone.aig mockturtle.dot mockturtle_roundtrip.aig
  ../aigtodot shared_cone.aig aiger.dot
  dot -Gdpi=144 -Tsvg abc.dot -o abc.svg
  dot -Gdpi=144 -Tsvg mockturtle.dot -o mockturtle.svg
  dot -Gdpi=144 -Tsvg aiger.dot -o aiger.svg
PNG rendering uses -Tpng with the same DPI.
Native DOT files were not edited. The composite uses one common image scale.
ABC's own DOT includes a title and a size constraint, affecting its drawing size.

Implementation and reproducibility
- DrawAig.cpp is the native mockturtle reader / write_dot / write_aiger driver.
- generate_comparison.py contains preparation, native commands, structural and
  exhaustive truth checks, composition and the optional aigverse overlay.
- Python "draw" needs Pillow and Graphviz. "prepare"/"highlight" need aigverse.
- Executables, build directories and source archives remain on the remote host.
- Remote experiment root:
  /home/wzh/my_code/netlistGraphBuilder/aig_visualization_research_20261114/same_aig_comparison
- Source directories:
  /home/wzh/open_source/abc
  /home/wzh/open_source/mockturtle
  /home/wzh/open_source/aiger

Versions
- ABC source d527cfab4ad731b767ea0a2be2021d920d3afece (ABC 1.01).
- mockturtle source a3f817de4005ee6ae12b4dd1ffcf4a4f910691d7.
- AIGER source SHA256 values recorded in manifest.json.
- aigverse 0.1.7.
- Graphviz 2.43.0, Pillow 9.0.1.

Compatibility details
- ABC was built out of tree with a C-only -Dnullptr=NULL flag because this
  source snapshot contains nullptr in giaCut.c. Source files were not changed.
- The aigverse/mockturtle binary writer emits a bare trailing 'c' comment
  delimiter. A newline was appended when preparing the shared input, before
  any of the three tools read it. This changes no circuit data. The strict
  AIGER reader rejects the original bare delimiter.
- These are execution compatibility details, not layout modifications.

Optional aigverse illustration
- aigverse_highlight.png/svg is custom visualization code using the actual
  DepthAig.is_on_critical_path and FanoutAig.fanout_size results.
- Red: nodes on maximum-logic-depth paths. This is unit-depth analysis, not STA.
- fo=N: fanout count (including output references); node width scales with it.
- Dashed edges: complemented signals.
- This is not a separate built-in GUI or a separate native layout algorithm.
- aigverse_metrics.json contains the underlying measured node attributes.

Verified references
https://github.com/berkeley-abc/abc/blob/master/src/base/io/ioWriteDot.c
https://github.com/berkeley-abc/abc/blob/master/src/base/abc/abcShow.c
https://github.com/lsils/mockturtle/blob/a3f817de4005ee6ae12b4dd1ffcf4a4f910691d7/include/mockturtle/io/write_dot.hpp
https://github.com/arminbiere/aiger/blob/master/aigtodot.c
https://aigverse.readthedocs.io/en/stable/visualization.html
https://github.com/marcelwa/aigverse/blob/main/src/aigverse/io/write_dot.cpp


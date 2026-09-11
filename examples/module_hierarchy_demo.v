// Module hierarchy demonstration fixture.
//
// Open hierarchy_demo_top, then expand Module hierarchy to inspect:
// - two independent occurrences of compute_cluster;
// - a five-level path through control_block/decode_stage/logic_leaf;
// - a separate I/O branch; and
// - the intentionally recursive cycle_probe branch, which terminates at a cycle marker.
//
// Every module has a small serial schematic on purpose, so the fixture can also
// remain inside the repository-wide layout readability budgets.

module hierarchy_demo_top(a, y);
  input a;
  output y;

  wire after_left;
  wire after_right;
  wire after_io;

  compute_cluster u_compute_left (
    .a(a), .y(after_left)
  );
  compute_cluster u_compute_right (
    .a(after_left), .y(after_right)
  );
  io_wrapper u_io (
    .a(after_right), .y(after_io)
  );
  diagnostic_wrapper u_diagnostic (
    .a(after_io), .y(y)
  );
endmodule

module compute_cluster(a, y);
  input a;
  output y;

  wire control_value;

  control_block u_control (
    .a(a), .y(control_value)
  );
  datapath_block u_datapath (
    .a(control_value), .y(y)
  );
endmodule

module control_block(a, y);
  input a;
  output y;

  wire decoded;

  decode_stage u_decode (
    .a(a), .y(decoded)
  );
  BUF u_output (
    .A(decoded), .Y(y)
  );
endmodule

module decode_stage(a, y);
  input a;
  output y;

  wire decoded;

  logic_leaf u_decode_leaf (
    .a(a), .y(decoded)
  );
  BUF u_output (
    .A(decoded), .Y(y)
  );
endmodule

module datapath_block(a, y);
  input a;
  output y;

  wire mixed;
  wire finalized;

  logic_leaf u_mix (
    .a(a), .y(mixed)
  );
  logic_leaf u_finalize (
    .a(mixed), .y(finalized)
  );
  BUF u_output (
    .A(finalized), .Y(y)
  );
endmodule

module io_wrapper(a, y);
  input a;
  output y;

  wire synced;

  sync_chain u_sync (
    .a(a), .y(synced)
  );
  BUF u_output (
    .A(synced), .Y(y)
  );
endmodule

module sync_chain(a, y);
  input a;
  output y;

  wire first_stage;
  wire second_stage;

  logic_leaf u_stage0 (
    .a(a), .y(first_stage)
  );
  logic_leaf u_stage1 (
    .a(first_stage), .y(second_stage)
  );
  BUF u_output (
    .A(second_stage), .Y(y)
  );
endmodule

module logic_leaf(a, y);
  input a;
  output y;

  wire copied;

  BUF u_copy (
    .A(a), .Y(copied)
  );
  INVX1 u_invert (
    .I(copied), .ZN(y)
  );
endmodule

module diagnostic_wrapper(a, y);
  input a;
  output y;

  cycle_probe u_cycle (
    .a(a), .y(y)
  );
endmodule

// This definition is intentionally recursive. The hierarchy builder must render
// u_self once with a cycle marker and must not attempt to expand it further.
module cycle_probe(a, y);
  input a;
  output y;

  wire recursive_value;

  cycle_probe u_self (
    .a(a), .y(recursive_value)
  );
  BUF u_output (
    .A(recursive_value), .Y(y)
  );
endmodule

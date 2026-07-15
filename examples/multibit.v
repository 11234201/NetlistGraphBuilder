module tc ( 
    y_out, 
    d2_in, 
    d1_in, 
    c_in, 
    b_in, 
    a_in, 
    rst_n, 
    clk ); 
    output [0:0] y_out; 
    input [0:0] d2_in; 
    input [0:0] d1_in; 
    input [0:0] c_in; 
    input [0:0] b_in;
    input [0:0] a_in; 
    input rst_n; 
    input clk;
    wire w_gen_108;
    wire sco_4;

    root_is_remap0_u0_1_50171648_2 LoResynHinst_of_module_root_is_remap0_u0_1_50171648_2_gen_111 (.sco_4(sco_4),
    .a_in_0(a_in[0]),
    .b_in_0(b_in[0]),
    .d2_in_0(d2_in[0]),
    .c_in_0(c_in[0]),
    .d1_in_0(d1_in[0]),
    .w_gen_108(w_gen_108));
    DFFSR \y_out_reg[0]  (.CLK(clk),
    .D(sco_4),
    .R(rst_n),
    .S(1'b1),
    .Q(y_out[0]));
    AND2X2 l_resyn2_u_gen_95 (.A(a_in[0]),
    .B(b_in[0]),
    .Y(w_gen_108));
endmodule


module root_is_remap0_u0_1_50171648_2 ( 
    sco_4, 
    a_in_0, 
    b_in_0, 
    d2_in_0, 
    c_in_0,
    d1_in_0, 
    w_gen_108 ); 
    output sco_4; 
    input a_in_0; 
    input b_in_0; 
    input d2_in_0;
    input c_in_0; 
    input d1_in_0; 
    input w_gen_108;
    wire w_gen_109;
    wire w_gen_107;
    wire sco_3;
    wire [0:0] a_in;
    wire [0:0] b_in;
    wire [0:0] d2_in;
    wire [0:0] c_in;
    wire [0:0] d1_in;
    assign a_in[0] = a_in_0 ;
    assign b_in[0] = b_in_0 ;
    assign d2_in[0] = d2_in_0 ;
    assign c_in[0] = c_in_0 ;
    assign d1_in[0] = d1_in_0 ;
    OAI21X1 remap0_u0 (.A(w_gen_109),
    .B(w_gen_107),
    .C(sco_3),
    .Y(sco_4));
    OR2X2 l_resyn2_u_gen_94 (.A(a_in[0]),
    .B(b_in[0]),
    .Y(w_gen_107));
    MUX2X1 l_resyn2_u_gen_96 (.A(1'b0),
    .B(d2_in[0]),
    .S(c_in[0]),
    .Y(w_gen_109));
    NAND3X1 l_resyn2_u_gen_97 (.A(c_in[0]),
    .B(d1_in[0]),
    .C(w_gen_108),
    .Y(sco_3));
endmodule
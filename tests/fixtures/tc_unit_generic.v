module tc ( y_out, salt_in, b_in, a_in, rst_n, clk ); output y_out;
input [31:0] salt_in; input [31:0] b_in; input [31:0] a_in; input rst_n; input
clk;

wire w15;
wire w17;
wire w26;
wire \salt_q[31] ;
wire \salt_q[30] ;
wire \salt_q[29] ;
wire \salt_q[28] ;
wire \salt_q[27] ;
wire \salt_q[26] ;
wire \salt_q[25] ;
wire \salt_q[24] ;
wire \salt_q[23] ;
wire \salt_q[22] ;
wire \salt_q[21] ;
wire \salt_q[20] ;
wire \salt_q[19] ;
wire \salt_q[18] ;
wire \salt_q[17] ;
wire \salt_q[16] ;
wire \salt_q[15] ;
wire \salt_q[14] ;
wire \salt_q[13] ;
wire \salt_q[12] ;
wire \salt_q[11] ;
wire \salt_q[10] ;
wire \salt_q[9] ;
wire \salt_q[8] ;
wire \salt_q[7] ;
wire \salt_q[6] ;
wire \salt_q[5] ;
wire \salt_q[4] ;
wire \salt_q[3] ;
wire \salt_q[2] ;
wire \salt_q[1] ;
wire \salt_q[0] ;
wire \b_q[31] ;
wire \b_q[30] ;
wire \b_q[29] ;
wire \b_q[28] ;
wire \b_q[27] ;
wire \b_q[26] ;
wire \b_q[25] ;
wire \b_q[24] ;
wire \b_q[23] ;
wire \b_q[22] ;
wire \b_q[21] ;
wire \b_q[20] ;
wire \b_q[19] ;
wire \b_q[18] ;
wire \b_q[17] ;
wire \b_q[16] ;
wire \b_q[15] ;
wire \b_q[14] ;
wire \b_q[13] ;
wire \b_q[12] ;
wire \b_q[11] ;
wire \b_q[10] ;
wire \b_q[9] ;
wire \b_q[8] ;
wire \b_q[7] ;
wire \b_q[6] ;
wire \b_q[5] ;
wire \b_q[4] ;
wire \b_q[3] ;
wire \b_q[2] ;
wire \b_q[1] ;
wire \b_q[0] ;
wire \a_q[31] ;
wire \a_q[30] ;
wire \a_q[29] ;
wire \a_q[28] ;
wire \a_q[27] ;
wire \a_q[26] ;
wire \a_q[25] ;
wire \a_q[24] ;
wire \a_q[23] ;
wire \a_q[22] ;
wire \a_q[21] ;
wire \a_q[20] ;
wire \a_q[19] ;
wire \a_q[18] ;
wire \a_q[17] ;
wire \a_q[16] ;
wire \a_q[15] ;
wire \a_q[14] ;
wire \a_q[13] ;
wire \a_q[12] ;
wire \a_q[11] ;
wire \a_q[10] ;
wire \a_q[9] ;
wire \a_q[8] ;
wire \a_q[7] ;
wire \a_q[6] ;
wire \a_q[5] ;
wire \a_q[4] ;
wire \a_q[3] ;
wire \a_q[2] ;
wire \a_q[1] ;
wire \a_q[0] ;
wire [31:0] w18;
wire [31:0] w19;
wire [31:0] w20;
wire [31:0] w21;
wire [31:0] w22;
wire [31:0] w23;
wire [31:0] w24;
wire [31:0] w25;

UNIT_ADFFR_PN_GATE \salt_q_reg[31]  (.clocked_on(clk),
  .next_state(salt_in[31]),
  .clear(rst_n),
  .Q(\salt_q[31] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[30]  (.clocked_on(clk),
  .next_state(salt_in[30]),
  .clear(rst_n),
  .Q(\salt_q[30] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[29]  (.clocked_on(clk),
  .next_state(salt_in[29]),
  .clear(rst_n),
  .Q(\salt_q[29] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[28]  (.clocked_on(clk),
  .next_state(salt_in[28]),
  .clear(rst_n),
  .Q(\salt_q[28] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[27]  (.clocked_on(clk),
  .next_state(salt_in[27]),
  .clear(rst_n),
  .Q(\salt_q[27] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[26]  (.clocked_on(clk),
  .next_state(salt_in[26]),
  .clear(rst_n),
  .Q(\salt_q[26] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[25]  (.clocked_on(clk),
  .next_state(salt_in[25]),
  .clear(rst_n),
  .Q(\salt_q[25] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[24]  (.clocked_on(clk),
  .next_state(salt_in[24]),
  .clear(rst_n),
  .Q(\salt_q[24] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[23]  (.clocked_on(clk),
  .next_state(salt_in[23]),
  .clear(rst_n),
  .Q(\salt_q[23] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[22]  (.clocked_on(clk),
  .next_state(salt_in[22]),
  .clear(rst_n),
  .Q(\salt_q[22] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[21]  (.clocked_on(clk),
  .next_state(salt_in[21]),
  .clear(rst_n),
  .Q(\salt_q[21] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[20]  (.clocked_on(clk),
  .next_state(salt_in[20]),
  .clear(rst_n),
  .Q(\salt_q[20] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[19]  (.clocked_on(clk),
  .next_state(salt_in[19]),
  .clear(rst_n),
  .Q(\salt_q[19] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[18]  (.clocked_on(clk),
  .next_state(salt_in[18]),
  .clear(rst_n),
  .Q(\salt_q[18] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[17]  (.clocked_on(clk),
  .next_state(salt_in[17]),
  .clear(rst_n),
  .Q(\salt_q[17] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[16]  (.clocked_on(clk),
  .next_state(salt_in[16]),
  .clear(rst_n),
  .Q(\salt_q[16] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[15]  (.clocked_on(clk),
  .next_state(salt_in[15]),
  .clear(rst_n),
  .Q(\salt_q[15] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[14]  (.clocked_on(clk),
  .next_state(salt_in[14]),
  .clear(rst_n),
  .Q(\salt_q[14] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[13]  (.clocked_on(clk),
  .next_state(salt_in[13]),
  .clear(rst_n),
  .Q(\salt_q[13] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[12]  (.clocked_on(clk),
  .next_state(salt_in[12]),
  .clear(rst_n),
  .Q(\salt_q[12] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[11]  (.clocked_on(clk),
  .next_state(salt_in[11]),
  .clear(rst_n),
  .Q(\salt_q[11] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[10]  (.clocked_on(clk),
  .next_state(salt_in[10]),
  .clear(rst_n),
  .Q(\salt_q[10] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[9]  (.clocked_on(clk),
  .next_state(salt_in[9]),
  .clear(rst_n),
  .Q(\salt_q[9] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[8]  (.clocked_on(clk),
  .next_state(salt_in[8]),
  .clear(rst_n),
  .Q(\salt_q[8] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[7]  (.clocked_on(clk),
  .next_state(salt_in[7]),
  .clear(rst_n),
  .Q(\salt_q[7] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[6]  (.clocked_on(clk),
  .next_state(salt_in[6]),
  .clear(rst_n),
  .Q(\salt_q[6] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[5]  (.clocked_on(clk),
  .next_state(salt_in[5]),
  .clear(rst_n),
  .Q(\salt_q[5] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[4]  (.clocked_on(clk),
  .next_state(salt_in[4]),
  .clear(rst_n),
  .Q(\salt_q[4] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[3]  (.clocked_on(clk),
  .next_state(salt_in[3]),
  .clear(rst_n),
  .Q(\salt_q[3] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[2]  (.clocked_on(clk),
  .next_state(salt_in[2]),
  .clear(rst_n),
  .Q(\salt_q[2] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[1]  (.clocked_on(clk),
  .next_state(salt_in[1]),
  .clear(rst_n),
  .Q(\salt_q[1] ));
UNIT_ADFFR_PN_GATE \salt_q_reg[0]  (.clocked_on(clk),
  .next_state(salt_in[0]),
  .clear(rst_n),
  .Q(\salt_q[0] ));
UNIT_ADFFR_PN_GATE \b_q_reg[31]  (.clocked_on(clk),
  .next_state(b_in[31]),
  .clear(rst_n),
  .Q(\b_q[31] ));
UNIT_ADFFR_PN_GATE \b_q_reg[30]  (.clocked_on(clk),
  .next_state(b_in[30]),
  .clear(rst_n),
  .Q(\b_q[30] ));
UNIT_ADFFR_PN_GATE \b_q_reg[29]  (.clocked_on(clk),
  .next_state(b_in[29]),
  .clear(rst_n),
  .Q(\b_q[29] ));
UNIT_ADFFR_PN_GATE \b_q_reg[28]  (.clocked_on(clk),
  .next_state(b_in[28]),
  .clear(rst_n),
  .Q(\b_q[28] ));
UNIT_ADFFR_PN_GATE \b_q_reg[27]  (.clocked_on(clk),
  .next_state(b_in[27]),
  .clear(rst_n),
  .Q(\b_q[27] ));
UNIT_ADFFR_PN_GATE \b_q_reg[26]  (.clocked_on(clk),
  .next_state(b_in[26]),
  .clear(rst_n),
  .Q(\b_q[26] ));
UNIT_ADFFR_PN_GATE \b_q_reg[25]  (.clocked_on(clk),
  .next_state(b_in[25]),
  .clear(rst_n),
  .Q(\b_q[25] ));
UNIT_ADFFR_PN_GATE \b_q_reg[24]  (.clocked_on(clk),
  .next_state(b_in[24]),
  .clear(rst_n),
  .Q(\b_q[24] ));
UNIT_ADFFR_PN_GATE \b_q_reg[23]  (.clocked_on(clk),
  .next_state(b_in[23]),
  .clear(rst_n),
  .Q(\b_q[23] ));
UNIT_ADFFR_PN_GATE \b_q_reg[22]  (.clocked_on(clk),
  .next_state(b_in[22]),
  .clear(rst_n),
  .Q(\b_q[22] ));
UNIT_ADFFR_PN_GATE \b_q_reg[21]  (.clocked_on(clk),
  .next_state(b_in[21]),
  .clear(rst_n),
  .Q(\b_q[21] ));
UNIT_ADFFR_PN_GATE \b_q_reg[20]  (.clocked_on(clk),
  .next_state(b_in[20]),
  .clear(rst_n),
  .Q(\b_q[20] ));
UNIT_ADFFR_PN_GATE \b_q_reg[19]  (.clocked_on(clk),
  .next_state(b_in[19]),
  .clear(rst_n),
  .Q(\b_q[19] ));
UNIT_ADFFR_PN_GATE \b_q_reg[18]  (.clocked_on(clk),
  .next_state(b_in[18]),
  .clear(rst_n),
  .Q(\b_q[18] ));
UNIT_ADFFR_PN_GATE \b_q_reg[17]  (.clocked_on(clk),
  .next_state(b_in[17]),
  .clear(rst_n),
  .Q(\b_q[17] ));
UNIT_ADFFR_PN_GATE \b_q_reg[16]  (.clocked_on(clk),
  .next_state(b_in[16]),
  .clear(rst_n),
  .Q(\b_q[16] ));
UNIT_ADFFR_PN_GATE \b_q_reg[15]  (.clocked_on(clk),
  .next_state(b_in[15]),
  .clear(rst_n),
  .Q(\b_q[15] ));
UNIT_ADFFR_PN_GATE \b_q_reg[14]  (.clocked_on(clk),
  .next_state(b_in[14]),
  .clear(rst_n),
  .Q(\b_q[14] ));
UNIT_ADFFR_PN_GATE \b_q_reg[13]  (.clocked_on(clk),
  .next_state(b_in[13]),
  .clear(rst_n),
  .Q(\b_q[13] ));
UNIT_ADFFR_PN_GATE \b_q_reg[12]  (.clocked_on(clk),
  .next_state(b_in[12]),
  .clear(rst_n),
  .Q(\b_q[12] ));
UNIT_ADFFR_PN_GATE \b_q_reg[11]  (.clocked_on(clk),
  .next_state(b_in[11]),
  .clear(rst_n),
  .Q(\b_q[11] ));
UNIT_ADFFR_PN_GATE \b_q_reg[10]  (.clocked_on(clk),
  .next_state(b_in[10]),
  .clear(rst_n),
  .Q(\b_q[10] ));
UNIT_ADFFR_PN_GATE \b_q_reg[9]  (.clocked_on(clk),
  .next_state(b_in[9]),
  .clear(rst_n),
  .Q(\b_q[9] ));
UNIT_ADFFR_PN_GATE \b_q_reg[8]  (.clocked_on(clk),
  .next_state(b_in[8]),
  .clear(rst_n),
  .Q(\b_q[8] ));
UNIT_ADFFR_PN_GATE \b_q_reg[7]  (.clocked_on(clk),
  .next_state(b_in[7]),
  .clear(rst_n),
  .Q(\b_q[7] ));
UNIT_ADFFR_PN_GATE \b_q_reg[6]  (.clocked_on(clk),
  .next_state(b_in[6]),
  .clear(rst_n),
  .Q(\b_q[6] ));
UNIT_ADFFR_PN_GATE \b_q_reg[5]  (.clocked_on(clk),
  .next_state(b_in[5]),
  .clear(rst_n),
  .Q(\b_q[5] ));
UNIT_ADFFR_PN_GATE \b_q_reg[4]  (.clocked_on(clk),
  .next_state(b_in[4]),
  .clear(rst_n),
  .Q(\b_q[4] ));
UNIT_ADFFR_PN_GATE \b_q_reg[3]  (.clocked_on(clk),
  .next_state(b_in[3]),
  .clear(rst_n),
  .Q(\b_q[3] ));
UNIT_ADFFR_PN_GATE \b_q_reg[2]  (.clocked_on(clk),
  .next_state(b_in[2]),
  .clear(rst_n),
  .Q(\b_q[2] ));
UNIT_ADFFR_PN_GATE \b_q_reg[1]  (.clocked_on(clk),
  .next_state(b_in[1]),
  .clear(rst_n),
  .Q(\b_q[1] ));
UNIT_ADFFR_PN_GATE \b_q_reg[0]  (.clocked_on(clk),
  .next_state(b_in[0]),
  .clear(rst_n),
  .Q(\b_q[0] ));
UNIT_ADFFR_PN_GATE \a_q_reg[31]  (.clocked_on(clk),
  .next_state(a_in[31]),
  .clear(rst_n),
  .Q(\a_q[31] ));
UNIT_ADFFR_PN_GATE \a_q_reg[30]  (.clocked_on(clk),
  .next_state(a_in[30]),
  .clear(rst_n),
  .Q(\a_q[30] ));
UNIT_ADFFR_PN_GATE \a_q_reg[29]  (.clocked_on(clk),
  .next_state(a_in[29]),
  .clear(rst_n),
  .Q(\a_q[29] ));
UNIT_ADFFR_PN_GATE \a_q_reg[28]  (.clocked_on(clk),
  .next_state(a_in[28]),
  .clear(rst_n),
  .Q(\a_q[28] ));
UNIT_ADFFR_PN_GATE \a_q_reg[27]  (.clocked_on(clk),
  .next_state(a_in[27]),
  .clear(rst_n),
  .Q(\a_q[27] ));
UNIT_ADFFR_PN_GATE \a_q_reg[26]  (.clocked_on(clk),
  .next_state(a_in[26]),
  .clear(rst_n),
  .Q(\a_q[26] ));
UNIT_ADFFR_PN_GATE \a_q_reg[25]  (.clocked_on(clk),
  .next_state(a_in[25]),
  .clear(rst_n),
  .Q(\a_q[25] ));
UNIT_ADFFR_PN_GATE \a_q_reg[24]  (.clocked_on(clk),
  .next_state(a_in[24]),
  .clear(rst_n),
  .Q(\a_q[24] ));
UNIT_ADFFR_PN_GATE \a_q_reg[23]  (.clocked_on(clk),
  .next_state(a_in[23]),
  .clear(rst_n),
  .Q(\a_q[23] ));
UNIT_ADFFR_PN_GATE \a_q_reg[22]  (.clocked_on(clk),
  .next_state(a_in[22]),
  .clear(rst_n),
  .Q(\a_q[22] ));
UNIT_ADFFR_PN_GATE \a_q_reg[21]  (.clocked_on(clk),
  .next_state(a_in[21]),
  .clear(rst_n),
  .Q(\a_q[21] ));
UNIT_ADFFR_PN_GATE \a_q_reg[20]  (.clocked_on(clk),
  .next_state(a_in[20]),
  .clear(rst_n),
  .Q(\a_q[20] ));
UNIT_ADFFR_PN_GATE \a_q_reg[19]  (.clocked_on(clk),
  .next_state(a_in[19]),
  .clear(rst_n),
  .Q(\a_q[19] ));
UNIT_ADFFR_PN_GATE \a_q_reg[18]  (.clocked_on(clk),
  .next_state(a_in[18]),
  .clear(rst_n),
  .Q(\a_q[18] ));
UNIT_ADFFR_PN_GATE \a_q_reg[17]  (.clocked_on(clk),
  .next_state(a_in[17]),
  .clear(rst_n),
  .Q(\a_q[17] ));
UNIT_ADFFR_PN_GATE \a_q_reg[16]  (.clocked_on(clk),
  .next_state(a_in[16]),
  .clear(rst_n),
  .Q(\a_q[16] ));
UNIT_ADFFR_PN_GATE \a_q_reg[15]  (.clocked_on(clk),
  .next_state(a_in[15]),
  .clear(rst_n),
  .Q(\a_q[15] ));
UNIT_ADFFR_PN_GATE \a_q_reg[14]  (.clocked_on(clk),
  .next_state(a_in[14]),
  .clear(rst_n),
  .Q(\a_q[14] ));
UNIT_ADFFR_PN_GATE \a_q_reg[13]  (.clocked_on(clk),
  .next_state(a_in[13]),
  .clear(rst_n),
  .Q(\a_q[13] ));
UNIT_ADFFR_PN_GATE \a_q_reg[12]  (.clocked_on(clk),
  .next_state(a_in[12]),
  .clear(rst_n),
  .Q(\a_q[12] ));
UNIT_ADFFR_PN_GATE \a_q_reg[11]  (.clocked_on(clk),
  .next_state(a_in[11]),
  .clear(rst_n),
  .Q(\a_q[11] ));
UNIT_ADFFR_PN_GATE \a_q_reg[10]  (.clocked_on(clk),
  .next_state(a_in[10]),
  .clear(rst_n),
  .Q(\a_q[10] ));
UNIT_ADFFR_PN_GATE \a_q_reg[9]  (.clocked_on(clk),
  .next_state(a_in[9]),
  .clear(rst_n),
  .Q(\a_q[9] ));
UNIT_ADFFR_PN_GATE \a_q_reg[8]  (.clocked_on(clk),
  .next_state(a_in[8]),
  .clear(rst_n),
  .Q(\a_q[8] ));
UNIT_ADFFR_PN_GATE \a_q_reg[7]  (.clocked_on(clk),
  .next_state(a_in[7]),
  .clear(rst_n),
  .Q(\a_q[7] ));
UNIT_ADFFR_PN_GATE \a_q_reg[6]  (.clocked_on(clk),
  .next_state(a_in[6]),
  .clear(rst_n),
  .Q(\a_q[6] ));
UNIT_ADFFR_PN_GATE \a_q_reg[5]  (.clocked_on(clk),
  .next_state(a_in[5]),
  .clear(rst_n),
  .Q(\a_q[5] ));
UNIT_ADFFR_PN_GATE \a_q_reg[4]  (.clocked_on(clk),
  .next_state(a_in[4]),
  .clear(rst_n),
  .Q(\a_q[4] ));
UNIT_ADFFR_PN_GATE \a_q_reg[3]  (.clocked_on(clk),
  .next_state(a_in[3]),
  .clear(rst_n),
  .Q(\a_q[3] ));
UNIT_ADFFR_PN_GATE \a_q_reg[2]  (.clocked_on(clk),
  .next_state(a_in[2]),
  .clear(rst_n),
  .Q(\a_q[2] ));
UNIT_ADFFR_PN_GATE \a_q_reg[1]  (.clocked_on(clk),
  .next_state(a_in[1]),
  .clear(rst_n),
  .Q(\a_q[1] ));
UNIT_ADFFR_PN_GATE \a_q_reg[0]  (.clocked_on(clk),
  .next_state(a_in[0]),
  .clear(rst_n),
  .Q(\a_q[0] ));
UNIT_ADFFR_PN_GATE y_out_reg (.clocked_on(clk),
  .next_state(w17),
  .clear(rst_n),
  .Q(y_out));
UNIT_LOGIC_NOT u4 (.A(rst_n),
  .Y(w15));
UNIT_EQ u5 (.A(w22),
  .B(w18),
  .Y(w17));
UNIT_AND u6 (.A(w21),
  .B(w19),
  .Y(w18));
UNIT_NOT u7 (.A(w20),
  .Y(w19));
UNIT_AND u8 (.A({ \b_q[31] , \b_q[30] , \b_q[29] , \b_q[28] , \b_q[27] , \b_q[26] , \b_q[25] , \b_q[24] , \b_q[23] , \b_q[22] , \b_q[21] , \b_q[20] , \b_q[19] , \b_q[18] , \b_q[17] , \b_q[16] , \b_q[15] , \b_q[14] , \b_q[13] , \b_q[12] , \b_q[11] , \b_q[10] , \b_q[9] , \b_q[8] , \b_q[7] , \b_q[6] , \b_q[5] , \b_q[4] , \b_q[3] , \b_q[2] , \b_q[1] , \b_q[0]  }),
  .B({ \salt_q[0] , \salt_q[31] , \salt_q[30] , \salt_q[29] , \salt_q[28] , \salt_q[27] , \salt_q[26] , \salt_q[25] , \salt_q[24] , \salt_q[23] , \salt_q[22] , \salt_q[21] , \salt_q[20] , \salt_q[19] , \salt_q[18] , \salt_q[17] , \salt_q[16] , \salt_q[15] , \salt_q[14] , \salt_q[13] , \salt_q[12] , \salt_q[11] , \salt_q[10] , \salt_q[9] , \salt_q[8] , \salt_q[7] , \salt_q[6] , \salt_q[5] , \salt_q[4] , \salt_q[3] , \salt_q[2] , \salt_q[1]  }),
  .Y(w20));
UNIT_OR u9 (.A({ \b_q[31] , \b_q[30] , \b_q[29] , \b_q[28] , \b_q[27] , \b_q[26] , \b_q[25] , \b_q[24] , \b_q[23] , \b_q[22] , \b_q[21] , \b_q[20] , \b_q[19] , \b_q[18] , \b_q[17] , \b_q[16] , \b_q[15] , \b_q[14] , \b_q[13] , \b_q[12] , \b_q[11] , \b_q[10] , \b_q[9] , \b_q[8] , \b_q[7] , \b_q[6] , \b_q[5] , \b_q[4] , \b_q[3] , \b_q[2] , \b_q[1] , \b_q[0]  }),
  .B({ \salt_q[31] , \salt_q[30] , \salt_q[29] , \salt_q[28] , \salt_q[27] , \salt_q[26] , \salt_q[25] , \salt_q[24] , \salt_q[23] , \salt_q[22] , \salt_q[21] , \salt_q[20] , \salt_q[19] , \salt_q[18] , \salt_q[17] , \salt_q[16] , \salt_q[15] , \salt_q[14] , \salt_q[13] , \salt_q[12] , \salt_q[11] , \salt_q[10] , \salt_q[9] , \salt_q[8] , \salt_q[7] , \salt_q[6] , \salt_q[5] , \salt_q[4] , \salt_q[3] , \salt_q[2] , \salt_q[1] , \salt_q[0]  }),
  .Y(w21));
UNIT_OR u10 (.A(w25),
  .B(w23),
  .Y(w22));
UNIT_AND u11 (.A(w24),
  .B({ \salt_q[30] , \salt_q[29] , \salt_q[28] , \salt_q[27] , \salt_q[26] , \salt_q[25] , \salt_q[24] , \salt_q[23] , \salt_q[22] , \salt_q[21] , \salt_q[20] , \salt_q[19] , \salt_q[18] , \salt_q[17] , \salt_q[16] , \salt_q[15] , \salt_q[14] , \salt_q[13] , \salt_q[12] , \salt_q[11] , \salt_q[10] , \salt_q[9] , \salt_q[8] , \salt_q[7] , \salt_q[6] , \salt_q[5] , \salt_q[4] , \salt_q[3] , \salt_q[2] , \salt_q[1] , \salt_q[0] , \salt_q[31]  }),
  .Y(w23));
UNIT_NOT u12 (.A({ \a_q[31] , \a_q[30] , \a_q[29] , \a_q[28] , \a_q[27] , \a_q[26] , \a_q[25] , \a_q[24] , \a_q[23] , \a_q[22] , \a_q[21] , \a_q[20] , \a_q[19] , \a_q[18] , \a_q[17] , \a_q[16] , \a_q[15] , \a_q[14] , \a_q[13] , \a_q[12] , \a_q[11] , \a_q[10] , \a_q[9] , \a_q[8] , \a_q[7] , \a_q[6] , \a_q[5] , \a_q[4] , \a_q[3] , \a_q[2] , \a_q[1] , \a_q[0]  }),
  .Y(w24));
UNIT_AND u13 (.A({ \a_q[31] , \a_q[30] , \a_q[29] , \a_q[28] , \a_q[27] , \a_q[26] , \a_q[25] , \a_q[24] , \a_q[23] , \a_q[22] , \a_q[21] , \a_q[20] , \a_q[19] , \a_q[18] , \a_q[17] , \a_q[16] , \a_q[15] , \a_q[14] , \a_q[13] , \a_q[12] , \a_q[11] , \a_q[10] , \a_q[9] , \a_q[8] , \a_q[7] , \a_q[6] , \a_q[5] , \a_q[4] , \a_q[3] , \a_q[2] , \a_q[1] , \a_q[0]  }),
  .B({ \salt_q[31] , \salt_q[30] , \salt_q[29] , \salt_q[28] , \salt_q[27] , \salt_q[26] , \salt_q[25] , \salt_q[24] , \salt_q[23] , \salt_q[22] , \salt_q[21] , \salt_q[20] , \salt_q[19] , \salt_q[18] , \salt_q[17] , \salt_q[16] , \salt_q[15] , \salt_q[14] , \salt_q[13] , \salt_q[12] , \salt_q[11] , \salt_q[10] , \salt_q[9] , \salt_q[8] , \salt_q[7] , \salt_q[6] , \salt_q[5] , \salt_q[4] , \salt_q[3] , \salt_q[2] , \salt_q[1] , \salt_q[0]  }),
  .Y(w25));
UNIT_LOGIC_NOT u14 (.A(rst_n),
  .Y(w26));

endmodule

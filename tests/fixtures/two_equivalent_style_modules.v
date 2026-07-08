module root_is_l_resyn3_u_gen_1395_7_159174_5 (
sco_897,
sco_900,
sco_891,
sco_917,
sco_710,
w_gen_1496,
sco_731,
\a_q[25] ,
\b_q[25]  );

input sco_897;
input sco_900;
output sco_891;
input sco_917;
input sco_710;
input w_gen_1496;
input sco_731;
input \a_q[25] ;
input \b_q[25] ;

wire sco_914;
wire sco_915;
wire sco_916;
wire w_gen_1480;

ND3X2APAH08HVT30P140 l_resyn3_u_gen_1395 (.A1(sco_914),
  .A2(sco_897),
  .A3(sco_900),
  .ZN(sco_891));

NR2X2APAH08HVT30P140 l_resyn3_u_gen_1390 (.A1(sco_915),
  .A2(sco_917),
  .ZN(sco_914));

CKND2X2H08HVT30P140 l_resyn3_u_gen_1382 (.A1(sco_916),
  .A2(sco_710),
  .ZN(sco_915));

NR3X2APAH08HVT30P140 l_resyn3_u_gen_1365 (.A1(w_gen_1496),
  .A2(w_gen_1480),
  .A3(sco_731),
  .ZN(sco_916));

XOR2X4AONH08HVT30P140 l_resyn3_u_gen_1340 (.A1(\a_q[25] ),
  .A2(\b_q[25] ),
  .Z(w_gen_1480));

endmodule

module root_is_l_resyn3_u_gen_1395_7_159174_5_Flex (
sco_897,
sco_900,
sco_891,
sco_917,
sco_710,
w_gen_1496,
sco_731,
\a_q[25] ,
\b_q[25]  );

input sco_897;
input sco_900;
output sco_891;
input sco_917;
input sco_710;
input w_gen_1496;
input sco_731;
input \a_q[25] ;
input \b_q[25] ;

wire sco_928;
wire sco_925;
wire w_gen_17;
wire sco_927;
wire w_gen_20;
wire sco_926;

assign sco_891 = sco_925 ;

NR2X1ATPH08HVT30P140 remap37_u1 (.A1(sco_917),
  .A2(sco_926),
  .ZN(sco_928));

NR3X4H08HVT30P140 l_resyn1_u_gen_3 (.A1(w_gen_17),
  .A2(sco_731),
  .A3(w_gen_1496),
  .ZN(w_gen_20));

CKINVX8H08HVT30P140 l_resyn1_u_gen_1 (.I(\a_q[25] ),
  .ZN(sco_927));

CKINVX8H08HVT30P140 l_resyn1_u_gen_0 (.I(sco_710),
  .ZN(w_gen_17));

XNR2X2AONH08HVT30P140 remap37_u0 (.A1(sco_927),
  .A2(\b_q[25] ),
  .ZN(sco_926));

ND4X3H08HVT30P140 l_resyn1_u_gen_5 (.A1(sco_928),
  .A2(sco_897),
  .A3(w_gen_20),
  .A4(sco_900),
  .ZN(sco_925));

endmodule


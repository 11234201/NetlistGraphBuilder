module \root_is_u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1208_0_1_83091_2 (
\u_dp_add_0/w_gen_1207 , \u_dp_add_0/out0_49 , sco_163, \u_dp_add_0/w_gen_756 ,
\u_dp_add_0/w_gen_754 ); input \u_dp_add_0/w_gen_1207 ; output
\u_dp_add_0/out0_49 ; input sco_163; input \u_dp_add_0/w_gen_756 ; input
\u_dp_add_0/w_gen_754 ;

wire \u_dp_add_0/w_gen_960 ;
wire [49:49] \u_dp_add_0/out0 ;

assign \u_dp_add_0/out0_49  = \u_dp_add_0/out0 [49] ;
XOR2X2AONH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1208_0  (.A1(\u_dp_add_0/w_gen_960 ),
  .A2(\u_dp_add_0/w_gen_1207 ),
  .Z(\u_dp_add_0/out0 [49]));
AOI21X1APBH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_959_0  (.A1(sco_163),
  .A2(\u_dp_add_0/w_gen_756 ),
  .B(\u_dp_add_0/w_gen_754 ),
  .ZN(\u_dp_add_0/w_gen_960 ));

endmodule

module \root_is_u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1134_0_13_78272_7 (
\u_dp_add_0/w_gen_1133 , \u_dp_add_0/out0_33 , sco_163, \u_dp_add_0/w_gen_320 ,
sco_75, sco_161, sco_91, \u_dp_add_0/w_gen_726 , \u_dp_add_0/w_gen_576 ,
sco_144, \u_dp_add_0/w_gen_434 , \u_dp_add_0/w_gen_440 , \u_dp_add_0/w_gen_438
); input \u_dp_add_0/w_gen_1133 ; output \u_dp_add_0/out0_33 ; output sco_163;
input \u_dp_add_0/w_gen_320 ; input sco_75; output sco_161; input sco_91; input
\u_dp_add_0/w_gen_726 ; input \u_dp_add_0/w_gen_576 ; input sco_144; input
\u_dp_add_0/w_gen_434 ; input \u_dp_add_0/w_gen_440 ; input
\u_dp_add_0/w_gen_438 ;

wire \u_dp_add_0/w_gen_896 ;
wire sco_164;
wire sco_92;
wire \u_dp_add_0/w_gen_578 ;
wire [33:33] \u_dp_add_0/out0 ;

assign \u_dp_add_0/out0_33  = \u_dp_add_0/out0 [33] ;
XOR2X2AONH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1134_0  (.A1(\u_dp_add_0/w_gen_896 ),
  .A2(\u_dp_add_0/w_gen_1133 ),
  .Z(\u_dp_add_0/out0 [33]));
AOI21X1APBH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_895_0  (.A1(sco_163),
  .A2(\u_dp_add_0/w_gen_320 ),
  .B(sco_75),
  .ZN(\u_dp_add_0/w_gen_896 ));
CKINVX16ADCH08HVT30P140 buf2inv0_u1 (.I(sco_164),
  .ZN(sco_163));
INVX8H08HVT30P140 buf2inv0_u0 (.I(sco_92),
  .ZN(sco_164));
OAI21X4APBH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_883_0  (.A1(sco_161),
  .A2(sco_91),
  .B(\u_dp_add_0/w_gen_726 ),
  .ZN(sco_92));
AOI21X6APBH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_723_0  (.A1(\u_dp_add_0/w_gen_576 ),
  .A2(sco_144),
  .B(\u_dp_add_0/w_gen_578 ),
  .ZN(sco_161));
OAI21X6ARAH08HVT30P140 \u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_577_0  (.A1(\u_dp_add_0/w_gen_434 ),
  .A2(\u_dp_add_0/w_gen_440 ),
  .B(\u_dp_add_0/w_gen_438 ),
  .ZN(\u_dp_add_0/w_gen_578 ));

endmodule

module \root_is_u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1208_0_1_83091_2_Flex (
\u_dp_add_0/w_gen_1207 , \u_dp_add_0/out0_49 , sco_163, \u_dp_add_0/w_gen_756 ,
\u_dp_add_0/w_gen_754 ); input \u_dp_add_0/w_gen_1207 ; output
\u_dp_add_0/out0_49 ; input sco_163; input \u_dp_add_0/w_gen_756 ; input
\u_dp_add_0/w_gen_754 ;

wire w_gen_9;
wire [49:49] \u_dp_add_0/out0 ;

assign \u_dp_add_0/out0_49  = \u_dp_add_0/out0 [49] ;
CKXOR2X1H08HVT30P140 l_resyn1_u_gen_1 (.A1(w_gen_9),
  .A2(\u_dp_add_0/w_gen_1207 ),
  .Z(\u_dp_add_0/out0 [49]));
AOI21X1H08HVT30P140 l_resyn1_u_gen_0 (.A1(sco_163),
  .A2(\u_dp_add_0/w_gen_756 ),
  .B(\u_dp_add_0/w_gen_754 ),
  .ZN(w_gen_9));

endmodule

module \root_is_u_dp_add_0/GNUWA_DYNAMIC_ADDER_gen_1134_0_13_78272_7_Flex (
\u_dp_add_0/w_gen_1133 , \u_dp_add_0/out0_33 , sco_163, \u_dp_add_0/w_gen_320 ,
sco_75, sco_161, sco_91, \u_dp_add_0/w_gen_726 , \u_dp_add_0/w_gen_576 ,
sco_144, \u_dp_add_0/w_gen_434 , \u_dp_add_0/w_gen_440 , \u_dp_add_0/w_gen_438
); input \u_dp_add_0/w_gen_1133 ; output \u_dp_add_0/out0_33 ; output sco_163;
input \u_dp_add_0/w_gen_320 ; input sco_75; output sco_161; input sco_91; input
\u_dp_add_0/w_gen_726 ; input \u_dp_add_0/w_gen_576 ; input sco_144; input
\u_dp_add_0/w_gen_434 ; input \u_dp_add_0/w_gen_440 ; input
\u_dp_add_0/w_gen_438 ;

wire w_gen_20;
wire w_gen_21;
wire [33:33] \u_dp_add_0/out0 ;

assign \u_dp_add_0/out0_33  = \u_dp_add_0/out0 [33] ;
CKXOR2X1H08HVT30P140 l_resyn1_u_gen_4 (.A1(w_gen_21),
  .A2(\u_dp_add_0/w_gen_1133 ),
  .Z(\u_dp_add_0/out0 [33]));
AOI21X1H08HVT30P140 l_resyn1_u_gen_3 (.A1(sco_163),
  .A2(\u_dp_add_0/w_gen_320 ),
  .B(sco_75),
  .ZN(w_gen_21));
OAI21X1H08HVT30P140 l_resyn1_u_gen_2 (.A1(sco_161),
  .A2(sco_91),
  .B(\u_dp_add_0/w_gen_726 ),
  .ZN(sco_163));
OA211X1H08HVT30P140 l_resyn1_u_gen_1 (.A1(\u_dp_add_0/w_gen_440 ),
  .A2(\u_dp_add_0/w_gen_434 ),
  .B(w_gen_20),
  .C(\u_dp_add_0/w_gen_438 ),
  .Z(sco_161));
CKND2X1H08HVT30P140 l_resyn1_u_gen_0 (.A1(sco_144),
  .A2(\u_dp_add_0/w_gen_576 ),
  .ZN(w_gen_20));

endmodule

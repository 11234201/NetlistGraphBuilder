# T02：四个超时的原 worker 采样与修复

日期：2026-10-13。范围：dp020、eq011、sop014、sop015 的布局布线门禁热点及必要验证。用户在明确询问恢复范围后回复“持续开发直到结束”；开始时已说明按该范围继续，不扩展其他性能项目。

基线：H08研究方案43/47，531文件冻结，production runtime404874；原47full-node、45s、strict validator。没有提高预算、缩图、collapse或跳过校验。

计划：45s有界V8采样 exact `cohesion_mapped_worker.mjs`，`C01_PHYSICAL_ANCHORS=1`、`--no-collapse --hard`。采样为诊断，不当未采样耗时基线；不启用onPhase全量事件，以免观测改变算法成本。日志/大profile留在 `/home/wzh/my_code/netlistGraphBuilder-physical-anchor-20261013/dc_runs/`。

准入：先确认热点及最低拥有边界；一次一个优化，保存前后完整node/port/route/physical-wire几何签名和输入身份；然后单测、排列/fixture、47原预算、必要benchmark。不能因采样说明可能热点就改算法或阈值。

T02完成：533文件采样前后冻结一致，四例各45s诊断超时。dp020、sop014、sop015主要热点为P2排名Map/树状态，兼有P3计数；eq011的StringEqual占55.4%，其中97.5%的调用来自P5 routing_dependencies候选收集，而非此前初步推测的排名阶段。采样不作为正式门禁结果。

T03第一步预注册：只将候选对的反复长ID比较/JSON键构造替换为局部整数身份。保留原始ID定向、JSON序列化键的完整排序、候选数量、几何谓词、取消检查和公共依赖结果；不改变搜索范围或算法。以旧枚举器逐项差分验证特殊字符、长公共前缀、focusIds和输入排列，随后远端单测及原45s worker验证。排名优化另行隔离进行。

第一步进度：旧枚举器完整输出差分及既有依赖测试4/4，完整unit761/761；eq011未采样原45s仍超时。第一步单独47例运行中，远端源文件冻结，未混入第二步。

第二步预注册：按P2采样证据，仅在simplex入口把已按canonical ID排序的节点/边映射为局部整数，原tight-tree、cut、pivot、peel、balance及迭代预算全部保持；出口恢复所有ranks、evidence和诊断ID。旧实现逐项比较完整Map插入顺序/初始rank/tree/cut/pivot/peel/balance，覆盖加权/最小长度/耗尽预算/长ID/排列/取消。先本地准备代码，不在第一步47冻结运行中同步；随后单独远端验证。

第一步47结束：36/47，11超时，完成例硬违规0；before/after源与runtime完全相同。eq011本轮33109ms通过（此前单例仍超时），不选择性覆盖失败记录。服务器96逻辑CPU，观测load58.47/66.31/65.14，其他用户有大规模并行计算；早期还与完整unit重叠。因此暂不声称新增超时由优化导致或排除退步，需同环境对照。原43/47历史结果不被覆盖。

第二步隔离差分2/2通过，含完整证据、Map迭代序、80节点加权DAG/剥离树、排列、取消及失败诊断；第一步冻结结束后同步到主测试目录。下一轮完整unit结束后再启动47例，避免本任务内部并行重负载。

必要benchmark预登记：正常npm benchmark另记（仍为现有UI默认provider，不能冒充候选证据）。独立热点A/B固定P5 64/128/256段、前缀0/1024/0；P2 80/160/320节点加权DAG、原thoroughness1预算；各3轮交替先后顺序，记录wall与process CPU并逐项断言输出相同。只做拥有边界诊断，不替代47例。

第二步完整unit763/763、正常benchmark1024/4096/8192 full-node硬0通过。热点6组每轮完整输出一致；P5长前缀128段wall中位143.586→10.795ms，CPU175.853→21.929ms。P2链约束DAG320节点wall11.071→7.137ms、CPU37.126→21.564ms，但160节点CPU5.528→7.994ms，不能声称全组都加速。P2生成器含强制完整链，未充分覆盖多pivot热点：预登记补充无强制链、source0连通加随机前向边，显式要求pivot/预算耗尽覆盖。第二轮47运行中不同步该测试修订。

第二轮47结束44/47，失败dp020/sop004/sop014；完成硬违规0，runtime83d2526b、全部源before/after相同。eq011与sop015通过；sop004为历史H08已通过而本轮超时，不能忽略。增强多pivot/耗尽差分2/2通过。重新45s采样这三个失败，sop014到validate，其余到layout，不预设同一原因。

下一步预注册：用Node24.16内置同步模块解析hook将两个精确算法模块URL分别映射到持久旧实现，仅研究worker消融；保持原input/policy/H08/45s/strict，不修改主源，不自动回退或进UI。先验证hook仅作用于精确URL和显式开关，再以sop004旧/新同环境对照解释新增超时；完整真实几何/SVG复核仍必须完成。

当前83d2526b再采样：dp020仍treeState8.9%及Map lookup26.3%；sop004采样原45s完成，空间索引与排名均有成本；sop014 treeState23.7%、inputDigest15.9%，尚未证明其终段validator是主导。预登记第三步仅缓存固定边权初始divergence，每次treeState复制后按原逆DFS累加；不缓存cut、不改变浮点加法顺序、选边、迭代和诊断。保存第二步完整实现为单独对照，补多pivot/耗尽测试与三案例原45s验证；摘要优化另行登记，不混入这一步。

第三步544文件冻结runtime51a32618，unit764/764；多pivot benchmark每轮完整结果相同。原45s：dp020超时、sop014超时、sop004通过；同环境旧P2/P5 sop004超时。不能认定sop004是新增语义退步，但尚无充分稳定性能准入证据。

第四步预注册：仅treeState内部将已intern的节点身份映射到Float64Array父节点/DFS序/子树大小/散度与边→子节点表，保留cut Map插入序；采用Float64避免隐式32位身份/大小范围。原邻接迭代与逆DFS加法顺序、cycle/spanning错误、inHead谓词完全不变。缓存实现另存对照，旧/string、interned、cached和indexed-state全部完整差分；加入分数权重，多pivot/耗尽与原45s失败例验证，不改变算法预算。

第四步unit764/764及全部对照benchmark结果相同，但dp020/sop014原45s仍超时，不能宣称解决。第五步预注册：按sop014 inputDigest15.9%采样证据，只消除portable SHA256每round的数组构造/解构，用相同有序标量赋值；不改序列化、UTF8、填充、常数、round算式或摘要/随机seed。旧SHA及Node内置SHA256对照空串、块边界、Unicode/孤立代理项/长输入；固定64KiB/1MiB/8MiB各3轮交替benchmark，保持同步离线无依赖，不引入平台特判。随后两失败原45s及完整47/真实图几何验证。

第五步549文件冻结runtimea7848ef2，unit765/765；SHA所有旧/内置向量一致，8MiB中位wall429.263→193.011ms，CPU429.362→220.789ms（1MiB CPU29.111→29.453ms，不能声称全尺寸都提升）。六产品完整nodes/ports/edges/wireRoutes/bounds/validation/排名证据相同，完成SVG逐字节相同；不等同用户视觉批准。dp020/sop014仍45s超时、stage=layout。

下一诊断预登记：研究worker模块load hook仅给同步相位函数加begin/end wall/CPU日志，不提供onPhase，不启用observe事件、不改变参数/返回/错误；先反例验证转换边界及实际小worker输出，再45s采样dp020/sop014。此计时用于归因，不当未观测门禁结果；未经新证据不改P3或最终validator。

轻量计时反例2/2及实际sop001非telemetry完整worker输出相同。dp020：P1 944ms/P2 11748ms/proper1638ms/P3 18318ms/P4 3398ms，进入P5后45s截断。sop014：P2 2226ms/P3 4436ms/P4 1013ms/P5 8748ms，两次validateRoutes3322/3270ms，finalize图校验6826ms，进入worker再次图校验后截断。证据否定“只剩排名”，日志留dc_runs/t03_timing_*。

第六步预注册：crossingContext内对冻结边拓扑预计算每层边界的DSU连接分组与参与端口集合，countCrossings继续按当前node/port顺序重新计算完整rank/box/Fenwick/corner分数。组key和边顺序不变；缓存在私有WeakMap，边界数组替换/长度/成员身份变化即回退重算，非冻结边不缓存。旧counter逐个排列比分数/上下文形状，反例覆盖同长度替换与可变边。没有P3候选/随机/迭代/约束或交叉预算变化；再跑原45s和完整几何。

第六步focused10/10、fullunit770/770。计时仍两例超时；dp020同一P2代码从11748→25822ms，sop014 P3从4436→5365ms，不能用跨进程时钟声称缓存加速。追加固定128节点/4层、shared/independent端口、每context100个旋转顺序、3轮交替旧/新同进程A/B（包含context构造），全部分数数组相同才记录收益。

用户对H08对照图的“SOP015/5404独立树和EQ1471整体可读性是否通过视觉门禁”明确回答“可以通过”。记录为这组H08视觉签收；后续性能版本只有完整几何/SVG与此基线相同时才能继承，不扩大为47门禁或UI/发布已完成。
# T03 next: indexed rank and traversal storage

Pre-registration: replace private ordinal-keyed rank/adjacency/reached maps with indexed storage. Keep rank insertion order, DFS rebuild/discovery order, edge scan order, all arithmetic and pivot budgets unchanged. Public ranks remain a Map. Require frozen-reference differential tests (including complete pivot evidence), full unit tests, six product geometry/SVG equality and the unchanged 47-case gate. This is not a new layout policy or a waiver of the remaining timeouts.

索引存储步骤：P2 focused 9/9、完整 unit 770/770。同进程交替三轮 lookup-320 诊断中位 wall 29.684→18.833ms、CPU 60.174→18.826ms，68 pivots，完整结果相同；不是全图门禁证据。六产品完整几何/证据与最终 SVG 再次与原 H08 全等，包括 SOP015/5404 和 EQ1471，故本快照继承指定视觉签收。原 47×45s/no-collapse/hard 全图门禁已启动，运行期间冻结代码，不提前切 UI。

本轮全图结束：45/47，dp020、sop014 原45s超时，其余45例零硬违规；sop004 30941ms、sop015 28493ms通过。before/after 全部 source/runtime 哈希相同，日志与原始结果留服务器 dc_runs/t03_lookup_47。与第二轮44/47相比增加一个完成案例，但不把负载相关的跨轮时钟当成单因素性能证据。UI、正式静态包和发布仍未准入。正常 benchmark 单独运行（全图退出1不得短路必需验证），仍为现有默认provider，不冒充候选性能验收。

冻结 runtime：sha256:5b7bdc64f5a2f877e0e09d09801b26dc6565729e0c56e035a5cc21d034428652。正常 simple-layered benchmark 1024/4096/8192 full-node 均 routed、硬0；布局203.8/1644.2/8000.8ms，属于共享现有路径验证，不是候选准入。全部本轮测试已结束，未提交、未切换UI、未发布。

## T04：同网候选分组索引（预登记）

沿既有 sop014 校验计时证据，在共享 RouteSegmentIndex 增加 opt-in foreign-net 查询。仅冻结且具有 own data netGroupKey 的记录可以合并候选分组；可变/getter 记录逐条过滤。组包围盒仅缩小候选，所有异网原线段、重复记录、近正交反向线段均保留，原几何谓词仍权威。原查询与默认路由不改行为，缓存按 bucket append 增量构造、rebuild 清空；同一桶查询结果保持原插入顺序。不删除任何重复校验、不增加预算。冻结旧 validator/索引，对完整有序诊断、输入不变性、动态所有权、删除/替换/compact、重复同对象、NaN键、2px阈值/ULP反向线段差分；同进程固定规模微基准、unit、六产品完整几何/SVG、原47与正常benchmark验收。

T04实现：私有WeakMap按bucket记录append增量分组，query结果按原记录ordinal恢复顺序，count谓词要求pure。共享validator/P5校验仅冻结自己生成的segment容器，不冻结调用方point，也不删除线段或任何重复校验。正常消费者不构造分组缓存。聚焦测试本地5/5（355ms）通过，覆盖40组图完整有序诊断及limit/排列，重复同对象、可变/getter、删除/替换/compact/rebuild与2px/ULP反向反例。

远端mfs-remote在本轮多次非交互SSH检查中均connect timeout，上一轮45/47证据不被覆盖。新快照尚未传输，实际45s计时也未开始；不在本地扩大为完整测试、大图或benchmark。固定benchmark预声明128/512/2048段、shared/independent/mixed三形态，每组100query与count、3轮交替、包含构造及cache初建且完整候选序/count等价。目前新快照的unit/六产品/47/正常benchmark均待远端恢复后执行，不声明加速或继承视觉签收。

后续继续请求下的环境诊断：mfs-remote解析为server.zexiwang.top:11022；DNS A为私网10.195.91.216，TCP连接失败，尚未进入SSH认证。不能由此确定是服务器停机、DNS还是本机网络路由。远端无法承载当前验证，按计算放置例外预登记临时本地范围：仅执行完整npm test，无大图/benchmark/新增大型输出。Windows正确性结果单列，不与Linux性能记录混用；47、六产品及候选性能仍须正式验证。

临时Windows完整npm test结束：781/781，0失败，11538ms，包括determinism、fixture与新增索引反例；未新增测试输出文件。该结果针对当前本地源码，不冒充之前Linux770快照或后续全图成绩。Test-NetConnection明确NameResolutionSucceeded=true、RemoteAddress=10.195.91.216、RemotePort=11022、TcpTestSucceeded=false；未修改DNS/路由/SSH配置。服务器恢复前不能验证六产品/SVG、候选benchmark及原47门禁，暂不继续叠加算法改动。

服务器恢复后T04第一版：Linux focused5/5、完整unit775/775（当前远端文件集合，非Windows781快照）。固定同进程基准全部输出等价；shared2048 wall17.254→1.595ms，但independent2048 wall20.965→31.240ms、CPU28.785→39.602ms，记录明确回退，不准入。下一步预登记仅表示优化：每桶独立网保持原record直接列表；出现第二个冻结同网record时才创建分组代理和原记录序表，候选不再额外构造逐项包装对象。append/顺序/动态key/所有原几何语义不变，重复同网仍不去重。重跑同一九组A/B与聚焦/完整unit后，再进行实际图和原预算门禁，不增加策略或放宽阈值。

直接record版focused5/5、Linux完整unit775/775；九组A/B全部输出等价，shared2048 wall16.538→1.330ms/CPU20.696→1.324ms，independent2048 wall21.062→16.191ms/CPU25.403→20.038ms。mixed2048 wall22.799→27.181ms但CPU33.164→28.236ms；小图多组有回退，不宣称全形态改善。独立网大组明确回退已移除，继续原45s实际图诊断及六产品/47，正式准入仍取决于全图与共享路径benchmark。

快照核对发现本地已存在的拼接连接更新未同步到旧研究目录（parser/model/graph/infer/inspection/hierarchy及pin_connections、connection-concat.test），解释775/781差异。保留本地实现不改，仅同步进自有远端测试目录后重做冻结/全部验证；历史775及45/47快照仍单列。一次含shell变量的诊断被PowerShell提前展开，ENOENT输出不计为任何案例结果；已改为显式路径，dp020有效计时进入finalize后窗口结束，P5 6755ms、两次validateRoutes3892/3375ms。不得用未完成最终校验宣称成功，也不移除重复校验。

对齐后unit先报两例ENOENT：遗漏tc_unit_generic.v；补同步既有17KB fixture，不改实现/断言。发现默认冻结范围只含elk_parity和mapped，遗漏其他单测输入；将两子根改为完整tests/fixtures根，新增包含tc/dp020且无重复path的门禁。只扩展研究provenance覆盖，runtime规则/45秒/47例/硬校验不变；随后重新unit、六产品与全图冻结运行，旧结果不覆盖。

完整同步快照Linux unit782/782；六产品完整nodes/ports/edges/wireRoutes/bounds/validation/排名证据和完成SVG与原H08再次全等，继承指定视觉签收。运行runtime e0d473b6a38a3f52ec9f326d7ba361f1e88aaf6889b27e7a15386aab0148d393，原47/no-collapse/hard/45000ms冻结复跑中；完成前不再同步/修改算法。Windows781、旧Linux775及历史45/47均不作为本快照全图成绩。

T04最终原47：46/47，只剩dp020原45s超时，完成硬0；sop014通过，source/runtime before/after全部相同。正常simple-layered benchmark1024/4096/8192 full-node均routed硬0，layout244.7/1740.9/7345.2ms；不是候选性能准入。原始结果留dc_runs/t04_complete_47、dc_runs/t04_complete_normal_benchmark.log。

## T05：实际最终校验同输入诊断（预登记）

只在research loader的显式capture开关下，将第一次validateLayoutGraph的完整graph/options用Node V8 serialize保存到远端ignored dc_runs；不启用onPhase/observe，不修改参数或原返回/错误，输入冻结后不再次运行布局。先验证普通capture控制例原输出相同与序列化保持Map/Set/undefined/-0，未选函数不产生捕获。对实际dp020完整phase input独立运行旧/当前validator，全部有序诊断相同再采样当前校验（仍45s有界）。这是全输入诊断，不缩图、不删检查、不替代原whole-worker45s门禁；不得由独立校验成功宣称47通过。取得热点前不改算法。

T05控制2/2通过、真实sop001完整非telemetry worker输出相同，Linux完整unit783/783。运行时仍e0d473b6，没有布局/布线算法修改；实际dp020原45s捕获中，完整二进制输入只留远端ignored dc_runs。

实际dp020捕获未到validateLayoutGraph：有效log到第二次validateRoutes结束，原45s结束，目录未创建；不得记为捕获成功。流水线源码核对确认两次P5检查之后还有adapter的placeWireLabels、buildWireRoutes、bounds，随后才finalize；前一“最终校验主导”尚未获得证据。扩展同一研究loader计时覆盖这三个明确边界，先重做小worker控制，再原45s定位。仍不改运行时，不提高窗口，不启用observe。

扩展计时控制完整非telemetry相同、unit783/783。实际dp020：labels226.9ms，buildWireRoutes8993.4ms/CPU13776.6ms，bounds37.1ms，final validate605.6ms；到worker第二次validate后45s结束。证据纠正此前尾段主要归validator的判断。下一步只研究捕获第一次buildWireRoutes的全部logical edges输入（不缩图）；先同样控制，再对完整input单次45s V8采样。所有源逻辑仍不变，取得物理线构建内部热点才登记等价优化，不凭阶段总时钟猜修复。

完整物理线输入捕获控制通过：2/2transform反例、真实sop001非telemetry全部一致、完整unit783/783。dp020全edges捕获原45s运行中；phase采样单次不更改whole-worker timer，无新增运行时策略。

T05实际全输入已捕获（4.3MB），11398 logical edges、5119 physical routes、127269最终segments；单次有界采样完成，wall12551ms/CPU15833ms（profile成本，不当基线），SetAdd14.2%、MapLookup7.4%、GC17.9%。主SetAdd bottom-up的79.3%来自buildNetTreeSegments，另有merge/toSegmentRecord集合转换及空间索引成本，不将其统称空间索引。诊断完成，正式成绩仍T04 46/47。

## T06：物理树回溯临时表示（预登记）

仅buildNetTreeSegments的target路径回溯：selectedIndices改为按原segment index的0/1标记，ownership Map改为原index数组（Set内容/插入序不变），每target新建visited Set改为单一Map存target序号epoch。Dijkstra/heap/tie/parent/sourceKeys/visited防环、target排序、fallback及输出原顺序均保持；包含invalid输入导致index间隙的旧行为，不借优化修正其他语义。冻结完整旧netTree/wireRoutes；随机、共享前缀、多source/cycle/forest/nonfinite/gaps分数坐标反例逐字段比较，完整捕获dp020同输入全部wireRoutes等价，随后unit/六产品/原47/正常benchmark。实际A/B固定一对且完整比较，耗时仅观察，不以单次百分比声称性能准入。取得这些证据前不切UI或发布。

第一版focused2/2、实际11398edges→5119routes/127269segments全部物理几何/归属/拓扑/顺序精确等价，单pair wall12975→12623ms/CPU19525→18912ms，仅小幅变化，不能声称解决。下一步仍同一表示边界：在原Dijkstra完成后，一次把已有vertex/source/parent键映射为整数，回溯使用parent数组、source标记及Float64 target epoch；保留原target排序/Set归属插入序/防环/不可达/fallback/index gap行为，不改任何Dijkstra计算、heap/tie或点坐标。该转换O(V+E)，没有新搜索或重试。再次同完整旧实现及actualinput对照后跑全验收。

整数回溯版focused2/2、Linux完整unit785/785；实际dp020完整11398edges、5119routes、127269segments全字段等价，固定单pair wall9579.6→7547.2ms/CPU13811.8→11547.7ms；单次不能扩大为稳定收益百分比。六产品完整几何/证据和最终SVG与H08全等，指定视觉继承。原47/no-collapse/hard/45s冻结复跑及正常benchmark串行运行，结束前不改源；是否解决dp020只由whole-worker门禁决定。

T06正式冻结结束仍46/47：dp020通过42159ms/hard0，sop014通过23425ms；唯一失败变为sop004原45s超时，不得忽略或以dp020通过冒充整体完成。全部source/runtime before/after一致（ea0bb197）；正常simple-layered1024/4096/8192 full-node硬0，layout215/1519.1/6553.7ms。T04 e0d473b6的46/47（仅dp020失败）保留，不能推断sop004新增超时一定是环境或算法。

T07预登记：在已有精确URL研究resolver中增加显式legacy-wire-tree开关，只将netTreeRouter.js映射冻结T06前旧实现，不覆盖主文件、不改布局/随机/其他模块/45s。先URL作用域与小worker非telemetry控制；同环境sop004旧tree/当前tree各一次原45s，保留两者结果，再决定是否需要进一步采样。无结果前不叠加运行时改动或提高timer。

T07 resolver作用域及小worker非telemetry一致，完整unit785/785。sop004旧tree16309ms、当前tree16722ms，两个原45s诊断均完成routed，完整非telemetry结果精确相同。单次current略慢约2.5%，不足排除性能回退，更不能覆盖T06正式超时。运行时未进一步修改；预登记同ea0bb197原47完整冻结复验一次，保留此前sop004失败及本次全部结果，不仅重跑通过例、不挑最好轮。

T07完整冻结复验结束47/47，failed0、hard violations0/0、noCollapse=true、timeout45000ms，最大layout40236ms、heap540MiB；before/after全部source/runtime相同，runtime仍ea0bb197b16b988f24ea71de946ed3b3b6f0ff25c66c95baf6dc2ca7ff128421。原始结果dc_runs/t07_same_runtime_47。T06同运行时sop004超时仍保留，不证明性能已经稳定；本次是最新完整门禁通过，不宣称所有样本/环境整体ELK水平。下一阶段为版本化H08静态P0/P3/P5及共享测量正式化；UI接线、Single/Compare/override/取消与离线发布仍未完成。


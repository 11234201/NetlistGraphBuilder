#include <mockturtle/networks/aig.hpp>
#include <mockturtle/io/aiger_reader.hpp>
#include <mockturtle/io/write_aiger.hpp>
#include <mockturtle/io/write_dot.hpp>
#include <lorina/aiger.hpp>
#include <iostream>

int main(int argc, char** argv)
{
  if (argc != 4) return 2;
  mockturtle::aig_network aig;
  auto const result = lorina::read_aiger(argv[1], mockturtle::aiger_reader(aig));
  if (result != lorina::return_code::success) return 3;
  mockturtle::write_dot(aig, argv[2]);
  mockturtle::write_aiger(aig, argv[3]);
  std::cout << "PI=" << aig.num_pis() << " AND=" << aig.num_gates()
            << " PO=" << aig.num_pos() << "\n";
}


{
  description = "O1-BETA benchmark results — public viewer (static)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: {
    # om wraps this into nixosConfigurations.container (handles dhcpcd /
    # networking). Same shape as the other static sites on this node.
    nixosModules.default = import ./nix/nixos-module.nix;
  };
}

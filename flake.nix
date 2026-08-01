{
  description = "O1-BETA benchmark results — public viewer";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # The dataset is a flake input, so the served page is a pure function of a
    # pinned commit. Refreshing is `--update-input benchmark-results` and a
    # redeploy — the site never fetches at runtime, so there is no rate limit
    # to hit and no way for the page to disagree with what was reviewed.
    benchmark-results = {
      url = "github:johnforfar/benchmark-results";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, benchmark-results }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      site = pkgs.runCommand "benchmark-site" { } ''
        ${pkgs.python3}/bin/python3 ${./generate.py} ${benchmark-results} $out
      '';
    in
    {
      packages.${system}.default = site;

      # om wraps this into nixosConfigurations.container.
      nixosModules.default = { ... }: {
        services.nginx = {
          enable = true;
          recommendedGzipSettings = true;
          virtualHosts."benchmark" = {
            default = true;
            listen = [ { addr = "0.0.0.0"; port = 8080; } ];
            root = "${site}";
            locations."/".index = "index.html";
            # Media is content addressed, so a given URL's bytes never change.
            locations."/media/".extraConfig = ''
              add_header Cache-Control "public, max-age=31536000, immutable";
            '';
          };
        };
        networking.firewall.allowedTCPPorts = [ 8080 ];
      };
    };
}

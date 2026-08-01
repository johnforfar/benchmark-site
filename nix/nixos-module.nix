{ pkgs, lib, ... }:
let
  # Rendered by generate.py from the benchmark-results dataset and committed,
  # so the container build stays a plain file copy — no build-time evaluation
  # against a nixpkgs the container module may not match.
  site = ../site;
in {
  services.nginx = {
    enable = true;
    recommendedGzipSettings = true;
    virtualHosts."benchmark" = {
      default = true;
      listen = [ { addr = "0.0.0.0"; port = 8080; } ];
      root = "${site}";
      locations."/".index = "index.html";
      # Media is content addressed, so a URL's bytes never change.
      locations."/media/".extraConfig = ''
        add_header Cache-Control "public, max-age=31536000, immutable";
      '';
    };
  };

  networking.firewall.allowedTCPPorts = [ 8080 ];
}

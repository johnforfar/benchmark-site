{
  inputs = {
    xnode-builders.url = "github:Openmesh-Network/xnode-builders";
    nixpkgs.follows = "xnode-builders/nixpkgs";
  };

  outputs =
    inputs:
    inputs.xnode-builders.language.auto {
      src = ./.;
      # Auto-detection sees astro.config and assumes a static site, which would
      # serve dist/ over static-web-server and 404 every route — this build is
      # SSR. `noext` because vite is configured with ssr.noExternal.
      framework = "astro-node-noext";
    };
}

# O1-BETA benchmark results — public viewer

Astro app serving the [benchmark-results](https://github.com/johnforfar/benchmark-results)
dataset with the same components the on-device app uses, so the charts here and
the charts an owner sees on their own machine are the same code rather than two
implementations that drift.

**Results only.** No benchmark can be started here: this runs on cloud hardware,
and a number produced anywhere other than the reference machine is not
comparable. `/api/bench-trigger` returns 403 by design.

## Refresh after new results are merged

```sh
python3 build-data.py /path/to/benchmark-results .   # bakes src/data + public/media
git commit -am "refresh dataset" && git push
om -p hermes app deploy --flake github:johnforfar/benchmark-site benchmark \
  --container xnodeos --firewall-port 3000
```

`--container xnodeos` is required: the default `xnode-manager` chassis module
sets `services.resolved.extraConfig`, which current nixpkgs has removed.

## Local

```sh
npm install && npx astro build && node ./dist/server/entry.mjs   # needs node >= 22
```

<!-- probe -->

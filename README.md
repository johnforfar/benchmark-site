# O1-BETA benchmark results — public viewer

Static site that renders the [benchmark-results](https://github.com/johnforfar/benchmark-results)
dataset. Deployed to cloud hardware, so it **displays results only** — it never
offers to run a benchmark, because a number produced anywhere other than the
reference hardware is not comparable.

## How it works

The dataset is a flake input. `generate.py` renders it to static HTML at build
time, so the served bytes are a pure function of a pinned commit: no runtime
fetching, no rate limits, and the deployment is reproducible from its inputs.

## Refresh after new results are merged

```sh
om -p hermes app deploy --flake github:johnforfar/benchmark-site benchmark \
  --update-input benchmark-results
```

## Local preview

```sh
python3 generate.py /path/to/benchmark-results ./out
python3 -m http.server -d out 8080
```

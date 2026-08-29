# Experiment - can the eval harness tell a prompt change from noise?

**Question.** L06 built a regression harness whose whole purpose is to answer
"did that prompt edit help". Before trusting it, two things have to be true: a
deliberate regression must be visible, and a run-to-run difference must be
bigger than what the model does on its own. So: what is the noise floor of this
harness, and which of the changes below clear it?

**Method.** One agent (*Security Reviewer*), one model (`gpt-4o-mini`), one
fixed twelve-case set. Nothing varies between runs except the agent's system
prompt and the `repeats` parameter. Inputs are fixed by construction - an eval
run passes only the system prompt, model, strategy, linked skills and the case
diff, so no repo-intel, intent or PR body can drift underneath the measurement.

> **Status: run, 2026-08-29.** Every number below is observed. The limitations
> section is not a disclaimer, it is the part that decides how much weight the
> conclusion carries.

---

## 1. Observations

`agent_version` is the config snapshot each run executed, so every row is
attributable to an exact prompt.

| v | repeats | prompt | recall | precision | citation | pass | cost |
|---|---|---|---|---|---|---|---|
| 5 | 1 | baseline | 25.0% | 33.3% | 81.8% | 4/12 | $0.0078 |
| 6 | 1 | + reporting threshold | 37.5% | 37.5% | 80.0% | 6/12 | $0.0079 |
| 7 | 1 | + "flag unused imports, always suggest something" | 37.5% | **23.1%** | 86.7% | 6/12 | $0.0083 |
| 8 | 1 | baseline again (v8 prompt == v5 prompt) | 25.0% | 37.5% | 72.7% | 5/12 | $0.0078 |
| 8 | 3 | baseline | 29.2% | 37.5% | 75.0% | 5/12 | $0.0234 |
| 9 | 3 | + reporting threshold | 41.7% | 45.8% | 77.4% | 6/12 | $0.0238 |
| 9 | 3 | + reporting threshold, again | 33.3% | 40.0% | 78.1% | 6/12 | $0.0240 |

## 2. The noise floor

Rows 1 and 4 are the same prompt (v8 was restored byte-identical to v5). Rows 6
and 7 are the same prompt as each other. Neither pair differs in anything but
the model's sampling.

| | same prompt, `repeats: 1` | same prompt, `repeats: 3` |
| --- | --- | --- |
| recall drift | 0.0 pt | 8.3 pt |
| precision drift | 4.2 pt | 5.8 pt |
| citation drift | 9.1 pt | 0.7 pt |
| case verdicts flipped | 1 of 12 | 0 of 12 |

**Ratio drift on this set is on the order of 5-10 points with nothing changed.**

## 3. What clears it, and what does not

**The deliberate regression clears it.** v6 -> v7 moved precision **-14.4 pt
while recall stayed flat**. That is roughly 2.5x the drift band, and the *shape*
is the stronger signal: noise pushes both ratios around, it does not hold one
still while driving the other down. A prompt told to flag unused imports and to
always produce a suggestion started reporting things a reviewer had dismissed,
which is exactly what the `noise` and `clean` cases exist to catch.

**The improvement does not clear it.** Measured properly at `repeats: 3`, the
reporting-threshold edit moved recall +12.5 pt and precision +8.3 pt against a
same-prompt drift of 8.3 and 5.8. About 1.5x noise, on one pair of runs. That is
not enough to attribute to the prompt, and the first reading of this experiment
called it a success on the strength of a single `repeats: 1` pair where the
precision gain (+4.2 pt) was *exactly* the size of the noise.

## 4. The finding that was not expected

Averaging three executions per case **did not shrink the ratio drift** - but it
took verdict flips from 1 of 12 to 0 of 12.

One spurious finding moves precision without failing any case, so the binary
per-case verdict is structurally steadier than the ratios computed over the same
runs. Two consequences:

- **Lead with the pass rate.** The three ratios are the diagnosis underneath it,
  not the headline. This is why the metric tiles are ordered the way they are.
- **`repeats` buys verdict stability, not ratio resolution.** To resolve a
  smaller effect, add cases. That is the cheaper lever anyway: cases are free to
  run once written, repeats cost per run forever.

## 5. Limitations

Each drift figure is **one pair of runs**, which is an order-of-magnitude
estimate and not a variance. In particular, recall drift reading 0.0 pt at
`repeats: 1` and 8.3 pt at `repeats: 3` almost certainly does not mean averaging
made recall less stable; it means a single pair says very little about a
distribution. The claim that survives both conditions is only the coarse one:
drift is on the order of 5-10 points, and verdicts are steadier than ratios.

Sharpening it needs repeated pairs per condition, which multiplies cost linearly
and was not worth it to establish a bound this crude.

## 6. Reproducing

```sh
./scripts/dev.sh
cd server && pnpm db:migrate && pnpm db:seed    # seeds the 12-case set
```

Then, per run, from the agent's Evals tab or:

```sh
curl -s -X POST localhost:3001/agents/<id>/eval-runs \
  -H 'content-type: application/json' -d '{"repeats":3}'
```

Editing the prompt in the Agent editor bumps `agent_version` and snapshots the
config, which is what makes two runs comparable as old-prompt-versus-new rather
than as two moments in time. Compare any two runs at
`GET /eval-runs/compare?left=&right=`, or tick two rows on `/eval/<agentId>`.

Total cost of the seven runs above: **$0.083**.

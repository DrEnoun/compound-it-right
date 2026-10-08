# Compound It Right

A webcam watches a student's hands during a step-by-step pharmacy compounding procedure and flags technique problems live, then exports a CSV/JSON report. It is a teaching aid: flags are prompts for the instructor, not a final grade. The video never leaves the device and it works offline.

## Run
Browsers only allow the webcam on `localhost` or https, so opening `index.html` directly will not work.

```
npm run serve      # then open http://localhost:8080
```

## Activities
Pick one from the drop-down. Each is a file in `data/protocols/`.

| Activity | Specific checks |
|---|---|
| Aseptic syringe transfer | Hands in the work zone, steady hands, slow draw, syringe tip-up when expelling air |
| Reconstituting a vial | Flags shaking, rewards gentle swirling, minimum swirl time |
| Trituration with mortar and pestle | Requires steady circular grinding, flags stopping or rushing, minimum grinding time |

General checks available to any activity: work zone (drag on the video to redraw it), unsteady, too fast, shaking, circular motion required, hand angle, number of hands, hands out of view, minimum or maximum step time, and minimum time of correct motion.

## What it cannot detect yet
The syringe, needle, vial or plunger themselves (wrong volume, bevel orientation, touching the needle). That needs an object-detection model trained on photos of your own apparatus. The rule engine in `js/rules.js` is built so a detector can feed into it.

## Configure
Edit the files in `data/protocols/` for steps, rules and thresholds, or add a new file and list it in `data/protocols/index.json`. The shipped values are an **example**: tune them against your lab SOP before using it for assessment.

## Test
`npm test`

Hand tracking: MediaPipe Hands, bundled in `vendor/mediapipe-hands/` (see its LICENSE-NOTE.md).

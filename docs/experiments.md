# Experiments

## GitHub Pages Combat Prototype

- Target: playable browser prototype in `docs/index.html`.
- Focus: fast 6x6 shared-field realtime battle feel before Godot export pipeline.
- Controls: WASD/Arrows, Q/E in-place turn, C/Tab flip, F phase, Space/Shift dash, J/Z gun, K/X sword, 1-4 chips.
- Implemented entry flow: title screen and Start Mission.
- Implemented command system: Mirror Phase and SYNC-powered Overclock Phase.
- Implemented progression: wave-clear 3-choice upgrade draft.
- Implemented mission goal: Wave 5 Signal Warden boss and result screen with performance rank.
- Implemented chips: LiDAR Sweep, Arc Snare, Vector Clone, Localization Jam.
- Implemented enemies: charger, turret, road worker, and Signal Warden boss.

## Next Combat Questions

- Is grid-step movement snappy enough, or should movement allow partial analog drift inside a cell?
- Should dash be invulnerability movement, attack movement, or both?
- Should chip cooldowns be time-based, deck-draw based, or hybrid?
- Does shared 6x6 positioning create enough identity, or should commands also manipulate rows, facing, and obstacles more aggressively?

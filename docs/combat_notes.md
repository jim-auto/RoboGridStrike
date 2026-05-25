# Combat Notes

## Current Feel Targets

- Combat uses a shared 6x6 field instead of separate player and enemy areas.
- Movement is cell-snapped and quick across the whole board.
- Facing has explicit in-place left/right and flip commands, with a short pivot animation.
- Mirror Phase shifts to the opposite side of the 6x6 field and sends a row pulse through crossed cells.
- Successful hits build SYNC; full SYNC turns the next Phase into Overclock Phase with stronger damage and faster cooldown recovery.
- Gun is a low damage default ranged attack with short cooldown.
- Sword is a default adjacent strike with a stronger cooldown.
- LiDAR Sweep is a piercing forward scan beam.
- Arc Snare creates short-lived control zones in the facing direction.
- Vector Clone combines fast repositioning, attack, and decoy afterimages.
- Localization Jam corrupts enemy targeting and creates short-lived jam zones.
- Road Worker enemies paint temporary work-lane hazards across the shared board.
- Clearing a wave opens a 3-choice upgrade draft before the next wave starts.

## Implemented Feedback

- Hitstop on successful hits.
- Screen shake on heavy impacts and damage.
- Basic WebAudio tones for attack and damage feedback.
- Player battle sprite now matches the maintenance robot art direction.
- Enemy HP bars and player invulnerability flicker.
- SYNC status and Phase cooldown are visible in the HUD.
- Upgrade cards show between waves and can be chosen with number keys or touch chip slots.
- Enemy windups show charge danger tiles and turret firing lines before attacks.
- Mobile touch controls support movement, turn, phase, dash, gun, sword, chips, and reboot.

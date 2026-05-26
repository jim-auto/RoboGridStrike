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
- Wave 5 is the Signal Warden boss, combining row locks, work zones, and barrier shifts.
- Defeating Signal Warden completes the mission and shows time, damage, overclock count, module count, and rank.

## Implemented Feedback

- Hitstop on successful hits.
- Screen shake on heavy impacts and damage.
- Basic WebAudio tones for attack and damage feedback.
- Player battle sprite now matches the maintenance robot art direction.
- Player and Signal Warden side art frame the battlefield.
- Enemy HP bars and player invulnerability flicker.
- SYNC status and Phase cooldown are visible in the HUD.
- Upgrade cards show between waves and can be chosen with number keys or touch chip slots.
- Signal Warden has a dedicated boss HP bar.
- Mission result screen shows an S/A/B/C rank.
- Enemy windups show charge danger tiles and turret firing lines before attacks.
- Mobile touch controls support movement, turn, phase, dash, gun, sword, chips, and reboot.

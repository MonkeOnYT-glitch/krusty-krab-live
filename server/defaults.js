// Action catalog and default gift/event → reaction mappings.
// Mapping keys: 'gift:<normalized gift name>', 'gift:*' (any other gift), 'event:follow', 'custom:<name>'.

export const ACTION_TYPES = {
  priority_boost: { label: 'Priority queue boost', params: { amount: null, scaleWithQuantity: true } },
  invite_apply: { label: 'Invite sender to apply (if no application)', params: {} },
  voice: { label: 'Voice line', params: { character: 'krabs', text: '' } },
  krabs_anim: { label: 'Mr. Krabs animation', params: { anim: 'excited' } },
  sponge_anim: { label: 'SpongeBob animation (non-dance)', params: { anim: 'cheer' } },
  spongebob_groove: { label: 'SpongeBob "I feel a groove coming on" dance (gifts only)', params: {} },
  sfx: { label: 'Sound effect', params: { sound: 'chime' } },
  music: { label: 'Music', params: { track: 'party' } },
  particles: { label: 'Particle effect', params: { kind: 'confetti' } },
  lighting: { label: 'Lighting change', params: { mode: 'party' } },
  camera: { label: 'Camera shot', params: { shot: 'wide' } },
  transition: { label: 'Screen transition', params: { style: 'flash' } },
  banner: { label: 'Temporary overlay banner', params: { text: '{user}', color: '#ffcc00' } },
  nuke: { label: 'Cinematic fictional "nuke" event', params: {} },
};

export const KRABS_ANIMS = ['idle', 'talk', 'inspect', 'excited', 'greedy', 'annoyed', 'suspicious', 'surprised', 'dance', 'shocked', 'laugh'];
export const SPONGE_ANIMS = ['idle', 'look', 'wave', 'cheer', 'shocked', 'flip']; // dance is only reachable via spongebob_groove
export const SOUNDS = ['chime', 'stamp', 'cash', 'airhorn', 'boom', 'drumroll', 'whoosh', 'pop', 'alarm'];
export const PARTICLES = ['petals', 'confetti', 'coins', 'bubbles', 'sparks'];
export const LIGHT_MODES = ['normal', 'party', 'red_alert', 'dim', 'golden'];
export const CAMERA_SHOTS = ['desk', 'wide', 'krabs_close', 'spongebob', 'paper', 'dramatic'];
export const TRANSITIONS = ['flash', 'fade', 'wipe'];
export const MUSIC = ['party', 'tension', 'fanfare'];

// duration: seconds; null = use the mapping's event duration. delay: ms after reaction start.
const a = (type, params = {}, delay = 0, duration = null, intensity = 1) => ({ type, params, delay, duration, intensity });

export function defaultMappings() {
  return {
    'gift:rose': {
      label: 'Rose — Priority Support', tickerText: 'Skip the hiring line', enabled: true, durationSec: 5, cooldownSec: 4, userCooldownSec: 0,
      overlap: 'queue', quantityMode: 'once', maxRepeats: 1,
      actions: [
        a('priority_boost', { amount: null, scaleWithQuantity: true }),
        a('banner', { text: '🌹 PRIORITY SUPPORT — {user}{xcount}', color: '#ff4d6d' }),
        a('particles', { kind: 'petals' }, 0, null, 1),
        a('sfx', { sound: 'chime' }),
        a('krabs_anim', { anim: 'greedy' }, 200, 2.5),
        a('voice', { character: 'krabs', text: 'A rose from {user}! Priority support, me favorite kind of support!' }, 300, null),
        a('invite_apply', {}, 400),
      ],
    },
    'gift:donut': {
      label: 'Donut — Dance Party', tickerText: 'Dance party + SpongeBob grooves', enabled: true, durationSec: 10, cooldownSec: 6, userCooldownSec: 0,
      overlap: 'queue', quantityMode: 'once', maxRepeats: 1,
      actions: [
        a('banner', { text: '🍩 DONUT DANCE PARTY — thanks {user}!', color: '#ff9de2' }),
        a('lighting', { mode: 'party' }),
        a('particles', { kind: 'confetti' }),
        a('music', { track: 'party' }),
        a('krabs_anim', { anim: 'dance' }, 300),
        a('spongebob_groove', {}, 0),
        a('voice', { character: 'krabs', text: 'A donut from {user}! Dance party! But nobody touches the register!' }, 500),
      ],
    },
    'gift:galaxy': {
      label: 'Galaxy — Cinematic "Nuke" Event', tickerText: 'Nuke the Krusty Krab', enabled: true, durationSec: 24, cooldownSec: 45, userCooldownSec: 0,
      overlap: 'queue', quantityMode: 'once', maxRepeats: 1,
      actions: [
        a('banner', { text: '🌌 {user} SENT A GALAXY!', color: '#8a7dff' }, 0, 3),
        a('nuke', {}, 0, null, 1),
        a('sponge_anim', { anim: 'shocked' }, 3500, 5),
        a('voice', { character: 'krabs', text: "Me restaurant! Me beautiful money-makin' restaurant!" }, 4800),
        a('voice', { character: 'krabs', text: 'Back in business! Somebody sweep up that mess!' }, 21800),
      ],
    },
    'gift:*': {
      label: 'Any other gift — Thank you', enabled: true, durationSec: 4, cooldownSec: 3, userCooldownSec: 10,
      overlap: 'queue', quantityMode: 'once', maxRepeats: 1,
      actions: [
        a('banner', { text: '🎁 {user} sent {gift}{xcount}', color: '#ffd166' }),
        a('sfx', { sound: 'cash' }),
        a('krabs_anim', { anim: 'excited' }, 0, 2),
      ],
    },
    'event:follow': {
      label: 'Follow — Welcome aboard', tickerText: 'Join the crew', enabled: true, durationSec: 4, cooldownSec: 5, userCooldownSec: 60,
      overlap: 'queue', quantityMode: 'once', maxRepeats: 1,
      actions: [
        a('banner', { text: '⚓ {user} joined the crew!', color: '#4dd2ff' }),
        a('sfx', { sound: 'pop' }),
      ],
    },
  };
}

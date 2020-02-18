eko
=========

A simple, lightweight sfx/music synthesizer in JavaScript based on the Web Audio API. Forked from the [TinyMusic](https://github.com/kevincennis/TinyMusic) library created by Kevin Ennis. I merged source files into a single "eko.js", added special effects, and added a `Tuner` class.

## Get started

See the source code in [./demo/index.html](demo/index.html) for full example, see the [demo](https://paladin-t.github.io/eko/demo/) to run it in browser.

Playing a piece of sfx with `eko` is pretty simple:

```js
// Opens the library.
var ctx = Eko.open();

// Creates a tuner instance.
var tuner = new Eko.Tuner(4, 64, 64);

// Constructs the notes.
var wav = Eko.wavSquare;
var sfx = [
  {
    'note': 'C3  q',
    'waveform': wav
  },
  {
    'note': 'D3  q',
    'waveform': wav
  },
  {
    'note': 'E3  q',
    'waveform': wav
  },
  {
    'note': 'F3  q',
    'waveform': wav
  },
  {
    'note': 'G3  q',
    'waveform': wav
  },
  {
    'note': 'A3  q',
    'waveform': wav
  },
  {
    'note': 'B3  q',
    'waveform': wav
  }
];
tuner.setSfxPattern(0, sfx);

// Sets the options.
tuner.setSfxOptions(
  0,
  {
    'loop': [ 3, 7 ],
    'staccato': 0.2
  }
);

// Plays it.
tuner.sfx(
  0, -1, -1, -1
);
```

Music in `eko` is composed by sfxs:

```js
// Fills the sfx patterns with index 0, 1, 2.
tuner.setSfxPattern(0, ...);
tuner.setSfxPattern(1, ...);
tuner.setSfxPattern(2, ...);

// Composes the sfxs index 0, 1, 2 to the music index 0.
tuner.setMusicPattern(0, [ 0, 1, 2 ]);

// Plays the music index 0.
tuner.music(0);
```

To set effects on a note:

```js
{
  'note': 'C4  q',
  'waveform': Eko.wavSquare,
  'fx': Eko.fxArpFast
}
```

`eko` supports the following PICO-8 compatible effects:

* `Eko.fxSlide`
* `Eko.fxVibrato`
* `Eko.fxDrop`
* `Eko.fxFadeIn`
* `Eko.fxFadeOut`
* `Eko.fxArpFast`
* `Eko.fxArpSlow`

You can also define your own waveform and effect data.

## Brief documentation

See the comment documentation in [./src/eko.js](src/eko.js) for details.

### API

Use the `Eko` interface to manipulate the lib:

```
`var tuner = new Eko.Tuner(...)` to construct a tuner,
`tuner.setSfxPattern(...)` to make an sfx pattern,
`tuner.setMusicPattern(...)` to make a music pattern, based on an array of sfx,
`tuner.setSfxOptions(...)` to set options of an sfx pattern,
`tuner.sfx(...)` to play sfx,
`tuner.music(...)` to play music,
`tuner.stop(...)` to stop specific channel(s).
```

### Legend

```
[ ] for array,
< > for optional to distinguish from array.
```

### Syntax

```
TONE = 'B#' | 'C' | 'C#' | 'Db' | 'D' | 'D#' | 'Eb' | 'E' | 'Fb' | 'E#' |
  'F' | 'F#' | 'Gb' | 'G' | 'G#' | 'Ab' | 'A' | 'A#' | 'Bb' | 'B' | 'Cb';
OCT = '0' | '1' | '2' | '3' | '4';
PAUSE = '-';
DURATION = 'w' | 'h' | 'q' | 'e' | 's' | Number; // For Whole, Half, Quarter, Eighth, Sixteenth...
VOLUME = Number;
NOTE = TONE, OCT, ' ', DURATION, <VOLUME>
     | PAUSE, ' ', DURATION, <VOLUME>;
NODE = NOTE | { 'note': NOTE, <'fx': EFFECTS>, <'waveform': WAVEFORM> };
SFX = [ NODE ] | [ NODE, NODE ];

FX_METHOD = 'arp' | 'function' | 'assign' | 'linear' | 'exp' | 'target' | 'curve';
FX_FIELD = 'any' | 'volume' | 'freq';
FX_VALUE = Number;
FX_CUTOFF = Boolean;
FX_WHEN = Number;
EFFECT = {
  'method': FX_METHOD,
  'field': FX_FIELD,
  'value': FX_VALUE,
  'cutoff': FX_CUTOFF,
  'when': FX_WHEN,
  <'proc': (index, data, moment, cutoff) => Void>
};
EFFECTS = [ EFFECT ] | [ EFFECT, EFFECT ];

WAVEFORM = { 'id': String, 'real': array of Number, 'imag': array of Number };

Note: All fields of the following options and controllers are optional.
OPTIONS = {
  'tempo': notes per minute,
  'loop': [ begin index, end index ],
  'staccato': time factor for mute,
  'smoothing': time factor
};
CONTROLLERS = {
  'when': time offset,
  'monopolized': whether occupies the channel exclusively,
  'type': either 'sfx' or 'music',
  'processor': [ head of processors, tail of processors ],
  'onFinished': () => Void, a callback function which will be called when an sfx is finished, for either sfx or music,
  'onAllFinished': () => Void, a callback function which will be called when music is finished, for music only
};
```

## Installation

* Grab and put [./src/eko.js](src/eko.js) to your project

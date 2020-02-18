/*
** A simple, lightweight sfx/music synthesizer in JavaScript based on the Web Audio API.
**
** Created by Kevin Ennis: https://github.com/kevincennis/TinyMusic
** Modified by Tony Wang: https://github.com/paladin-t/eko
**
** API:
**   Use the `Eko` interface to manipulate the lib:
**     `var tuner = new Eko.Tuner(...)` to construct a tuner,
**     `tuner.setSfxPattern(...)` to make an sfx pattern,
**     `tuner.setMusicPattern(...)` to make a music pattern, based on an array of sfx,
**     `tuner.setSfxOptions(...)` to set options of an sfx pattern,
**     `tuner.sfx(...)` to play sfx,
**     `tuner.music(...)` to play music,
**     `tuner.stop(...)` to stop specific channel(s).
**
** Legend:
**   [ ] for array,
**   < > for optional to distinguish from array.
**
** Syntax:
**   TONE = 'B#' | 'C' | 'C#' | 'Db' | 'D' | 'D#' | 'Eb' | 'E' | 'Fb' | 'E#' |
**     'F' | 'F#' | 'Gb' | 'G' | 'G#' | 'Ab' | 'A' | 'A#' | 'Bb' | 'B' | 'Cb';
**   OCT = '0' | '1' | '2' | '3' | '4';
**   PAUSE = '-';
**   DURATION = 'w' | 'h' | 'q' | 'e' | 's' | Number; // For Whole, Half, Quarter, Eighth, Sixteenth...
**   VOLUME = Number;
**   NOTE = TONE, OCT, ' ', DURATION, <VOLUME>
**        | PAUSE, ' ', DURATION, <VOLUME>;
**   NODE = NOTE | { 'note': NOTE, <'fx': EFFECTS>, <'waveform': WAVEFORM> };
**   SFX = [ NODE ] | [ NODE, NODE ];
**
**   FX_METHOD = 'arp' | 'function' | 'assign' | 'linear' | 'exp' | 'target' | 'curve';
**   FX_FIELD = 'any' | 'volume' | 'freq';
**   FX_VALUE = Number;
**   FX_CUTOFF = Boolean;
**   FX_WHEN = Number;
**   EFFECT = {
**     'method': FX_METHOD,
**     'field': FX_FIELD,
**     'value': FX_VALUE,
**     'cutoff': FX_CUTOFF,
**     'when': FX_WHEN,
**     <'proc': (index, data, moment, cutoff) => Void>
**   };
**   EFFECTS = [ EFFECT ] | [ EFFECT, EFFECT ];
**
**   WAVEFORM = { 'id': String, 'real': array of Number, 'imag': array of Number };
**
**   Note: All fields of the following options and controllers are optional.
**   OPTIONS = {
**     'tempo': notes per minute,
**     'loop': [ begin index, end index ],
**     'staccato': time factor for mute,
**     'smoothing': time factor
**   };
**   CONTROLLERS = {
**     'when': time offset,
**     'monopolized': whether occupies the channel exclusively,
**     'type': either 'sfx' or 'music',
**     'processor': [ head of processors, tail of processors ],
**     'onFinished': () => Void, a callback function which will be called when an sfx is finished, for either sfx or music,
**     'onAllFinished': () => Void, a callback function which will be called when music is finished, for music only
**   };
*/

(function (root, factory) {
  if (typeof define == 'function' && define.amd) {
    define([ 'exports' ], factory);
  } else if (typeof exports == 'object' && typeof exports.nodeName != 'string') {
    factory(exports);
  } else {
    factory(root.Eko = { });
  }
}(this, function (exports) {

	/*
	** {========================================================
	** Private stuffs
	*/

  var noteOn = 0;

  var enharmonics = 'B#-C|C#-Db|D|D#-Eb|E-Fb|E#-F|F#-Gb|G|G#-Ab|A|A#-Bb|B-Cb',
    middleC = 440 * Math.pow(Math.pow(2, 1 / 12), -9),
    numeric = /^[0-9.]+$/,
    octaveOffset = 4,
    space = /\s+/,
    num = /(\d+)/,
    offsets = { };

  // Populates the offset lookup (note distance from C, in semitones).
  enharmonics.split('|').forEach(
    function (val, i) {
      val.split('-').forEach(
        function (note) {
          offsets[note] = i;
        }
      );
    }
  );

  /* ========================================================} */

	/*
	** {========================================================
	** Note class
	*/

	/**
	 * Creates a note instance from a string or an object with effects.
	 *
	 * @param note - E.g.
	 *   `new Note('A4 q')` for 440Hz, quarter note;
	 *   `new Note('- e')` for 0Hz (basically a rest), eigth note;
	 *   `new Note('A4 es')` for 440Hz, dotted eighth note (eighth + sixteenth);
	 *   `new Note('A4 0.0125')` for 440Hz, 32nd note (or any arbitrary divisor/multiple of 1 beat).
	 */
  function Note(note) {
    // Unpacks the information.
    var tuple = null;
    var fx = null;
    var waveform = null;
    if (typeof note == 'object') {
      tuple = note['note'];
      fx = note['fx'];
      waveform = note['waveform'];
    } else {
      tuple = note;
    }
    // Splits the basic note tuple.
    tuple = tuple.split(space);
    // Frequency, in Hz.
    this.frequency = Note.getFrequency(tuple[0]) || 0;
    // Duration, as a ratio of 1 beat (quarter note = 1, half note = 0.5, etc.).
    this.duration = Note.getDuration(tuple[1]) || 0;
    // Gist volume, with value of range from 0.0 to 1.0.
    this.volume = Note.getVolume(tuple[2]) || 1;
    // Assigns effects.
    this.fx = fx;
    // Assigns waveform.
    this.waveform = waveform;
  }

	/**
	 * Converts a note name to a frequency (e.g. 'A4' to 440).
	 */
  Note.getFrequency = function (name) {
    if (name == undefined || name == null)
      name = '-';

    var couple = name.split(num),
      distance = offsets[couple[0]],
      octaveDiff = (couple[1] || octaveOffset) - octaveOffset,
      freq = middleC * Math.pow(Math.pow(2, 1 / 12), distance);

    return freq * Math.pow(2, octaveDiff);
  };

	/**
	 * Converts a duration string to a number (e.g. 'q' to 1),
	 * also accepts numeric strings (e.g. '0.125')
	 * and compund durations (e.g. 'es' for dotted-eight or eighth plus sixteenth).
	 */
  Note.getDuration = function (symbol) {
    if (symbol == undefined || symbol == null)
      symbol = 'q';

    return numeric.test(symbol) ? parseFloat(symbol) :
      symbol.toLowerCase().split('').reduce(
        function (prev, curr) {
          return prev + (curr == 'w' ? 4 : curr == 'h' ? 2 :
            curr == 'q' ? 1 : curr == 'e' ? 0.5 :
              curr == 's' ? 0.25 : 0);
        },
        0
      );
  };

	/**
	 * Converts volume string to a float number.
	 */
  Note.getVolume = function (num) {
    if (num == undefined || num == null)
      num = '1';

    return parseFloat(num);
  };

  /* ========================================================} */

	/*
	** {========================================================
	** Waveform class
	*/

	/**
	 * Creates a waveform for a single note.
	 */
  function Waveform(wav, begin, end) {
    if (typeof wav == 'string') {
      this.type = wav;
      this.id = 'builtin/' + wav;
    } else {
      this.type = 'custom';
      this.id = wav['id'];
      this.wave = null;
      this.real = wav['real'];
      this.imag = wav['imag'] || this.real;
    }
    this.begin = begin;
    this.end = end;
  }

	/**
	 * Affects the oscillator of an audio sequence with a specific waveform or customized periodic wave.
	 */
  Waveform.prototype.affect = function (seq) {
    var waveforms = seq.waveforms;
    if (waveforms.last == this.id)
      return this;

    if (this.type == 'custom') {
      if (!this.wave) {
        // See https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-createperiodicwave
        this.wave = seq.ac.createPeriodicWave.apply(
          seq.ac,
          [ new Float32Array(this.real), new Float32Array(this.imag) ]
        );
      }
      seq.osc.setPeriodicWave(this.wave);
    } else {
      seq.osc.type = this.type;
    }
    waveforms.last = this.id;

    return this;
  };

	/**
	 * Creates a bunch of waveforms.
	 */
  function Waveforms() {
    this.waveforms = [ ];
    this.updater = null;
    this.ticks = 0;
    this.index = -1;
    this.last = null;
    this.affected = false;
  }

	/**
	 * Accepts waveform instances, and its absolute begin/end time.
	 */
  Waveforms.prototype.push = function (wav, begin, end) {
    this.waveforms.push(wav instanceof Waveform ? wav : new Waveform(wav, begin, end));

    return this;
  };

	/**
	 * Plays a waveform modifier. Not 100% accurate, but yeah...
	 */
  Waveforms.prototype.play = function (seq) {
    if (this.waveforms.length == 0)
      return this;

    var diff = 10;
    this.ticks = 0;
    this.index = -1;
    this.affected = false;
    if (this.updater == null) {
      this.ticks = 0;
      this.index = -1;
      this.affected = false;

      var update = function () {
        if (this.index == -1) {
          this.index = 0;
          if (this.index < this.waveforms.length) {
            if (this.ticks >= this.waveforms[this.index].begin && this.ticks < this.waveforms[this.index].end) {
              this.affected = true;
              this.waveforms[this.index].affect(seq);
            }
          }
        } else {
          this.ticks += diff / 1000;
          var tobeAffected = -1;
          if (this.ticks >= this.waveforms[this.index].end) {
            if (++this.index >= this.waveforms.length) {
              this.index = this.waveforms.length - 1;
            }
            this.affected = false;
            tobeAffected = this.index;
          } else if (this.ticks >= this.waveforms[this.index].begin) {
            tobeAffected = this.affected ? -1 : this.index;
          }
          if (tobeAffected != -1) {
            if (this.ticks >= this.waveforms[this.index].begin && this.ticks < this.waveforms[this.index].end) {
              this.affected = true;
              this.waveforms[this.index].affect(seq);
            }
          }
        }
      }.bind(this);
      this.updater = setInterval(update, diff);
    }

    return this;
  };

	/**
	 * Stops a waveform modifier.
	 */
  Waveforms.prototype.stop = function () {
    if (this.updater != null) {
      clearInterval(this.updater);
      this.updater = null;
    }
    this.last = null;

    return this;
  };

  /* ========================================================} */

	/*
	** {========================================================
	** Sequence class
	*/

	/**
	 * Creates a sequence.
	 */
  function Sequence(ac, tempo, arr, processor) {
    this.ac = ac || new AudioContext() || new webkitAudioContext();
    this.createFxNodes(processor);
    this.tempo = tempo || 132;
    this.loop = true;
    this.smoothing = 0;
    this.staccato = 1 / 8;
    this.notes = [ ];
    this.sliceOriginal = null;
    this.sliceOffset = 0;
    this.push.apply(this, arr || [ ]);
    this.waveforms = new Waveforms();
    this.monopolized = false;
    this.type = null;
    this.onCycled = null;
    this.onFinished = null;
  }

	/**
	 * Creates gain and EQ nodes, then connect 'em.
	 */
  Sequence.prototype.createFxNodes = function (processor) {
    var eq = [ [ 'bass', 100 ], [ 'mid', 1000 ], [ 'treble', 2500 ] ],
      prev = this.gain = this.ac.createGain();
    eq.forEach(
      function (config, filter) {
        filter = this[config[0]] = this.ac.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = config[1];
        prev.connect(prev = filter);
      }.bind(this)
    );
    if (processor) {
      if (processor.length == 2) {
        prev.connect(processor[0]);
        processor[1].connect(this.ac.destination);
      } else {
        throw new Error('Invalid processor.'); // Requires a pair of linked processors.
      }
    } else {
      prev.connect(this.ac.destination);
    }

    return this;
  };

	/**
	 * Accepts note instances or strings (e.g. 'A4 e') or objects with effects.
	 */
  Sequence.prototype.push = function () {
    Array.prototype.forEach.call(
      arguments,
      function (note) {
        this.notes.push(note instanceof Note ? note : new Note(note));
      }.bind(this)
    );

    return this;
  };

	/**
	 * Creates a custom waveform as opposed to 'sawtooth', 'triangle', etc.
	 */
  Sequence.prototype.createCustomWave = function (real, imag) {
    // Allows user to specify only one array and dupe it for imag.
    if (!imag) {
      imag = real;
    }

    // Wave type must be custom to apply period wave.
    this.waveType = 'custom';

    // Resets `customWave`.
    this.customWave = [ new Float32Array(real), new Float32Array(imag) ];
  };

	/**
	 * Recreates the oscillator node (happens on every play).
	 */
  Sequence.prototype.createOscillator = function () {
    this.stop();
    this.osc = this.ac.createOscillator();

    // `customWave` should be an array of `Float32Arrays`. The more elements in
    // each `Float32Array`, the dirtier (saw-like) the wave is.
    if (this.customWave) {
      this.osc.setPeriodicWave(
        this.ac.createPeriodicWave.apply(this.ac, this.customWave)
      );
    } else {
      this.osc.type = this.waveType || 'square';
    }

    this.osc.connect(this.gain);
    if (noteOn == 1 && typeof this.osc.noteOn == 'function') {
      this.osc.noteOn(0); // Some browsers would be mute until invoking `noteOn` within a user event callback.
      noteOn = 2;
    }

    return this;
  };

	/**
	 * Schedules `this.notes[index]` to play at the given time.
	 *
	 * @returns An `AudioContext` timestamp of when the note will end.
	 */
  Sequence.prototype.scheduleNote = function (index, begin, when, init) {
    var duration = 60 / this.tempo * this.notes[index].duration,
      cutoff = duration * (1 - (this.staccato || 0));

    this.setFrequency(this.notes[index].frequency, when);
    this.setVolume(this.notes[index].volume, when);

    if (this.smoothing && this.notes[index].frequency) {
      this.slide(index, when, cutoff);
    }

    var tocutoff = true;
    if (this.notes[index].fx) {
      tocutoff = this.affect(index, when, duration, cutoff);
    }

    if (init) {
      if (this.notes[index].waveform) {
        this.waveforms.push(this.notes[index].waveform, when - begin, when - begin + duration);
      }
    }

    if (tocutoff)
      this.setFrequency(0, when + cutoff);

    return when + duration;
  };

	/**
	 * Gets the next note.
	 */
  Sequence.prototype.getNextNote = function (index) {
    return this.notes[index < this.notes.length - 1 ? index + 1 : 0];
  };

	/**
	 * How long do we wait before beginning the slide (in seconds).
	 */
  Sequence.prototype.getSlideStartDelay = function (duration) {
    return duration - Math.min(duration, 60 / this.tempo * this.smoothing);
  };

	/**
	 * Slides the note at `index` into the next note at the given time,
	 * and applies staccato effect if needed.
	 */
  Sequence.prototype.slide = function (index, when, cutoff) {
    var next = this.getNextNote(index),
      start = this.getSlideStartDelay(cutoff);
    this.setFrequency(this.notes[index].frequency, when + start);
    this.osc.frequency.linearRampToValueAtTime(next.frequency, when + cutoff);

    return this;
  };

	/**
	 * See PICO-8 for details.
	 */
  Sequence.prototype.arp = function (index, when, delay, striches) {
    var original = this.sliceOriginal || this.notes;
    var idx = this.sliceOffset + index;
    var sec = Math.floor(idx / 4);
    var note = [ 0, 0, 0, 0 ];
    var valid = -1;
    for (var i = 0; i < 4; ++i) {
      var pos = sec * 4 + i;
      if (pos >= original.length)
        pos = sec * 4 + Math.floor(idx % valid); // Rewinds to the head again.
      else
        valid = i;
      var n = original[pos];
      note[i] = n;
    }
    for (var i = 0; i < striches; ++i) {
      this.setFrequency(note[i % 4].frequency, when + delay * i / striches);
    }
    this.setFrequency(note[3].frequency, when + delay);

    return this;
  };

	/**
	 * Applies effects to a note.
	 */
  Sequence.prototype.affect = function (index, when, duration, cutoff) {
    var result = true;
    var fx = this.notes[index].fx;
    if (!fx)
      return result;
    for (var i = 0; i < fx.length; ++i) {
      var subfx = fx[i];
      var method = subfx['method'];
      var field = subfx['field'] || 'any';
      var data = subfx['value'];
      var tocutoff = subfx['cutoff'] || false;
      var moment = when + subfx['when'] * (tocutoff ? cutoff : duration);
      switch (field) {
        case 'any':
          // Does nothing.
          break;
        case 'volume':
          field = this.gain.gain;
          data *= this.notes[index].volume;
          break;
        case 'freq':
          field = this.osc.frequency;
          data *= this.notes[index].frequency;
          break;
        default:
          throw new Error('Unknown field.');
      }
      switch (method) {
        case 'arp':
          this.arp(index, when, duration, data);
          result = false;
          break;
        case 'function':
          var proc = subfx['proc'];
          proc.call(this, index, data, moment, cutoff);
          break;
        case 'assign':
          // See https://www.w3.org/TR/webaudio/#dom-audioparam-setvalueattime
          field.setValueAtTime(data, moment /* to start */);
          break;
        case 'linear':
          // See https://www.w3.org/TR/webaudio/#dom-audioparam-linearramptovalueattime
          field.linearRampToValueAtTime(data, moment /* to end */);
          break;
        case 'exp':
          // See https://www.w3.org/TR/webaudio/#dom-audioparam-exponentialramptovalueattime
          field.exponentialRampToValueAtTime(data, moment /* to end */);
          break;
        case 'target':
          // See https://www.w3.org/TR/webaudio/#dom-audioparam-settargetattime
          field.setTargetAtTime(data, moment /* to start */, subfx['constant'] /* time constant */);
          break;
        case 'curve':
          // See https://www.w3.org/TR/webaudio/#dom-audioparam-setvaluecurveattime
          field.setValueCurveAtTime(subfx['values'], moment /* to start */, subfx['duration'] /* duration */);
          break;
        default:
          throw new Error('Unknown effect method.');
      }
    }
    // Seealso https://www.w3.org/TR/webaudio/#example1-AudioParam

    return result;
  };

	/**
	 * Sets the volume at a specific time.
	 */
  Sequence.prototype.setVolume = function (vol, when) {
    this.gain.gain.setValueAtTime(vol, when /* to start */);

    return this;
  };

	/**
	 * Sets the frequency at a specific time.
	 */
  Sequence.prototype.setFrequency = function (freq, when) {
    this.osc.frequency.setValueAtTime(freq, when);

    return this;
  };

	/**
	 * Private method to play an audio sequence.
	 */
  Sequence.prototype.$play = function (when, init) {
    var now = this.ac.currentTime;
    when = typeof when == 'number' ? when : now;

    if (this.notes.length > 0 && (typeof this.notes[0]['waveform'] == 'string')) {
      this.waveType = this.notes[0]['waveform'];
    }
    this.createOscillator();
    this.osc.start(when);

    var begin = when;
    this.notes.forEach(
      function (note, i) {
        when = this.scheduleNote(i, begin, when, init);
      }.bind(this)
    );

    this.waveforms.play(this);
    var rewind = function () {
      this.$play(when, false)
      if (typeof this.onCycled == 'function')
        this.onCycled();
    };
    var stop = function () {
      this.waveforms.stop();
      if (typeof this.onCycled == 'function')
        this.onCycled();
      if (typeof this.onFinished == 'function')
        this.onFinished();
    };
    this.osc.stop(when);
    this.osc.onended = this.loop ? rewind.bind(this) : stop.bind(this);

    return this;
  };

	/**
	 * Runs through all notes in the sequence and schedules them.
	 */
  Sequence.prototype.play = function (when) {
    return this.$play(when, true);
  };

	/**
	 * Stops playback, resets the oscillator, cancels parameter automation.
	 */
  Sequence.prototype.stop = function () {
    if (this.osc) {
      this.osc.onended = null;
      this.osc.disconnect();
      this.osc = null;
    }
    if (this.waveforms) {
      this.waveforms.stop();
    }

    return this;
  };

  /* ========================================================} */

	/*
	** {========================================================
	** Tuner class
	*/

	/**
	 * Constructs a tuner.
	 */
  function Tuner(channels, sfxMaxCount, musicMaxCount) {
    // Gets the context.
    this.context = exports.open();
    // Prepares the channels.
    this.channels = [ ];
    for (var i = 0; i < channels; ++i)
      this.channels.push(null);
    // Prepares the option slots for the sfx patterns.
    this.sfxOptions = [ ];
    for (var i = 0; i < sfxMaxCount; ++i)
      this.sfxOptions.push(null);
    // Prepares the slots for the sfx patterns.
    this.sfxPatterns = [ ];
    for (var i = 0; i < sfxMaxCount; ++i)
      this.sfxPatterns.push(null);
    // Prepares the slots for the music patterns.
    this.musicPatterns = [ ];
    for (var i = 0; i < musicMaxCount; ++i)
      this.musicPatterns.push(null);
    // Constants.
    this.SFX = 'sfx';
    this.MUSIC = 'music';
  }

	/**
	 * Gets the sfx options at a specific position.
	 *
	 * @returns Options object, throws exception for out of bounds accessing.
	 */
  Tuner.prototype.getSfxOptions = function (n) {
    if (n < 0 || n >= this.sfxOptions.length)
      throw new Error('SFX option index out of bounds.');

    return this.sfxOptions[n] || { };
  }
	/**
	 * Sets the sfx options at a specific position.
	 */
  Tuner.prototype.setSfxOptions = function (n, options) {
    if (n >= 0 && n < this.sfxOptions.length)
      this.sfxOptions[n] = options;
    else
      throw new Error('SFX option index out of bounds.');

    return this;
  }

	/**
	 * Sets the sfx pattern at a specific position.
	 *
	 * @param n - The pattern index to set.
	 * @param notes - A sequence of playable notes.
	 */
  Tuner.prototype.setSfxPattern = function (n, notes) {
    if (n >= 0 && n < this.sfxPatterns.length)
      this.sfxPatterns[n] = notes;
    else
      throw new Error('SFX pattern index out of bounds.');

    return this;
  }

	/**
	 * Sets the music pattern at a specific position.
	 *
	 * @param n - The pattern index to set.
	 * @param sfxs - An array of indices (of sfx pattern), can contain `null` holes.
	 */
  Tuner.prototype.setMusicPattern = function (n, sfxs) {
    if (n >= 0 && n < this.musicPatterns.length)
      this.musicPatterns[n] = sfxs;
    else
      throw new Error('Music pattern index out of bounds.');

    return this;
  }

	/**
	 * Stops a specific channel from playing, or stops all.
	 *
	 * @param channel - The specific channel to stop, -1 to stop all.
	 */
  Tuner.prototype.stop = function (channel) {
    var seq = null;
    if (channel == -1) {
      for (var i = 0; i < this.channels.length; ++i) {
        seq = this.channels[i];
        if (seq)
          seq.stop();
        this.channels[i] = null;
      }
    }
    if (channel < 0 || channel >= this.channels.length)
      return this;
    seq = this.channels[channel];
    if (seq)
      seq.stop();
    this.channels[channel] = null;

    return this;
  }

	/**
	 * Plays the sfx `n` on a `channel` from note `offset` for `length` notes.
	 *
	 * @param n - -1 to stop the sound on that channel,
	 *   -2 to release the sound on that channel from looping.
	 * @param channel - Any music playing on the channel will be halted.
	 *   -1 (default) to automatically choose a channel that is not being used,
	 *   -2 to stop the sound from playing on any channel.
	 * @param offset - The note offset to start from, -1 for the head.
	 * @param length - The note count to play through, -1 for all.
	 */
  Tuner.prototype.sfx = function (n, channel, offset, length, controllers) {
    var seq = null;
    if (channel >= 0 && channel < this.channels.length) seq = this.channels[channel];

    if (n == -1) {
      this.stop(channel);

      return this;
    } else if (n == -2) {
      if (seq)
        seq.loop = false;

      return this;
    } else if (n < 0 || n >= this.sfxPatterns.length) {
      throw new Error('SFX pattern index out of bounds.');
    } else if (!this.sfxPatterns[n]) {
      exports.D('No such SFX at', n, '.');

      return this;
    }

    if (channel == -1) {
      // Selects a channel automatically.
      for (var i = 0; i < this.channels.length; ++i) {
        seq = this.channels[i];
        if (!seq) {
          channel = i;

          break;
        }
      }
      if (channel == -1) {
        for (var i = 0; i < this.channels.length; ++i) {
          seq = this.channels[i];
          if (seq && !seq.monopolized) {
            channel = i;

            break;
          }
        }
      }
    } else if (channel == -2) {
      this.stop(-1);

      return this;
    }

    if (channel < 0 || channel >= this.channels.length)
      return this;

    var compose = function (notes_, tempo_, loop_, staccato_, smoothing_, processor_) {
      var seq_ = new Sequence(this.context, tempo_, notes_, processor_);
      seq_.staccato = staccato_;
      if (smoothing_) seq_.smoothing = smoothing_;
      seq_.loop = loop_;

      return seq_;
    }.bind(this);
    var play = function (seq_, channel_, monopolized_, when_) {
      seq_.monopolized = monopolized_;
      seq_.play(when_);
      if (this.channels[channel_])
        this.channels[channel_].stop();
      this.channels[channel_] = seq_;

      return seq_;
    }.bind(this);
    controllers = controllers || { };
    var options = this.getSfxOptions(n);
    var notes = this.sfxPatterns[n];
    var tempo = options['tempo'] || 132;
    var loop = options['loop'] || null;
    var staccato = typeof options['staccato'] == 'number' ? options['staccato'] : 1 / 8;
    var smoothing = options['smoothing'] || null;
    var when = controllers['when'] || null;
    var monopolized = !!controllers['monopolized'];
    var type = controllers['type'] || this.SFX;
    var processor = controllers['processor'] || null;
    var onFinished = controllers['onFinished'] || null;
    var tagA = loop ? loop[0] : 0;
    var tagB = loop ? loop[1] : 0;
    if (offset > 0) {
      notes = notes.slice(offset);
      tagA -= offset;
      tagB -= offset;
    }
    if (length > 0) {
      notes = notes.slice(0, length);
    }
    if ((tagA >= 0 && tagB > 0) && (tagA <= notes.length && tagB <= notes.length) && (tagA <= tagB)) {
      var original = compose(notes, tempo, false, staccato, smoothing, processor).notes;
      var slice = notes.slice(0, tagA);
      seq = compose(slice, tempo, false, staccato, smoothing, processor); // Composes prelude.
      seq.sliceOriginal = original;
      seq.sliceOffset = Math.max(offset, 0);
      seq.onCycled = function () { // Calls back when the prelude finished performing.
        slice = notes.slice(tagA, tagB); // Loops between [A, B).
        seq = compose(slice, tempo, true, staccato, smoothing, processor);
        seq.sliceOriginal = original;
        seq.sliceOffset = Math.max(offset + tagA, 0);
        seq.type = type;
        seq.onCycled = null;
        play(seq, channel, monopolized, null);
        exports.D('SFX looping at', n, 'on channel', channel, 'from', tagA, 'till', tagB, '.');
      }.bind(this);
    } else {
      seq = compose(notes, tempo, false, staccato, smoothing, processor);
      seq.onCycled = function () {
        seq.stop();
        this.channels[channel] = null;
        exports.D('SFX finished normally at', n, 'on channel', channel, '.');
      }.bind(this);
      seq.onFinished = onFinished;
    }
    seq.type = type;
    play(seq, channel, monopolized, when);

    return this;
  };

	/**
	 * Plays the music starting from pattern `n`.
	 *
	 * @param n - -1 to stop the music.
	 * @param channelMask - Specifies on which channels to reserve for music only.
	 *   e.g. to play on the channels 0, 1 and 2, use (1 << 0) | (1 << 1) | (1 << 2) = 7.
	 *   Reserved channels can still be used to play sound effects, if that
	 *   channel index is explicitly specified by `sfx()`.
	 * @param fadeLen - In seconds, -1 for none.
	 */
  Tuner.prototype.music = function (n, channelMask, fadeLen, processors, controllers) {
    if (n == -1) {
      for (var i = 0; i < this.channels.length; ++i) {
        var seq = this.channels[i];
        if (seq && seq.type == this.MUSIC)
          this.stop(i);
      }

      return this;
    }

    if (n < 0 || n >= this.musicPatterns.length)
      throw new Error('Music pattern index out of bounds.');

    var sfxs = this.musicPatterns[n];
    if (!sfxs) {
      exports.D('No such music at', n, '.');

      return this;
    }

    var when = this.context.currentTime;
    var count = 0;
    for (var i = 0; i < sfxs.length; ++i) {
      var sfx = sfxs[i];
      if (sfx == null || sfx == undefined || sfx < 0 || !this.sfxPatterns[sfx]) { // The pattern array can contain holes.
        ++count;

        continue;
      }
      var gain = null;
      if (fadeLen > 0) {
        gain = this.context.createGain();
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(1, when + fadeLen);
      }
      var monopolized = !!(channelMask & (1 << i));
      var processor = null;
      if (processors && i <= processors.length) {
        processor = processors[i];
        if (gain) {
          gain.connect(processor[0]);
          processor = [gain, processor[1]];
        }
      } else {
        if (gain)
          processor = [gain, gain]
      }
      var ctrls = {
        'when': when,
        'monopolized': monopolized,
        'type': this.MUSIC,
        'processor': processor
      };
      if (controllers) {
        for (var prop in controllers)
          ctrls[prop] = controllers[prop];
        if (typeof controllers['onAllFinished'] == 'function') {
          ctrls['onFinished'] = function () {
            if (++count >= sfxs.length) {
              controllers['onAllFinished']();
            }
          };
        }
      }
      this.sfx(sfx, i, -1, -1, ctrls);
    }

    return this;
  };

  /* ========================================================} */

	/*
	** {========================================================
	** Exporting
	*/

  exports.Note = Note;
  exports.Sequence = Sequence;
  exports.Tuner = Tuner;

  exports.D = console.log;

  exports.context = null;

  exports.open = function () {
    // Returns the context directly if it was already opened.
    if (exports.context) {
      return exports.context;
    }

    // Creates an audio context that all later operations will work on.
    var ctx = exports.context || (typeof AudioContext != 'undefined' ? new AudioContext : new webkitAudioContext);
    var callback = function () {
      // Plays a dummy sound on touch start for some browsers to unmute the WebAudio,
      // see https://stackoverflow.com/a/12569290
      var seq = new Sequence(ctx, 1, [ '- 0' ]);
      seq.loop = false;
      noteOn = 1;
      seq.play(0); // Will call `noteOn`.
      exports.D('WebAudio enabled.');
      window.removeEventListener('touchend', callback);
    };
    window.addEventListener('touchend', callback, false);
    exports.context = ctx;

    return ctx;
  };

  // Prefab effects.

  exports.fxSlide = [
    {
      'method': 'function',
      'field': 'any',
      'when': 0,
      'value': 0.4,
      'proc': function (index, data, moment, cutoff) {
        var backup = this.smoothing;
        this.smoothing = data;
        this.slide(index, moment, cutoff);
        this.smoothing = backup;
      }
    }
  ];
  exports.fxVibrato = [
    {
      'method': 'linear',
      'field': 'volume',
      'when': 0,
      'value': 0.5
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 1 / 6,
      'value': 1
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 2 / 6,
      'value': 0
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 3 / 6,
      'value': 0.5
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 4 / 6,
      'value': 1
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 5 / 6,
      'value': 0
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 0.999,
      'value': 0.5
    }
  ];
  exports.fxDrop = [
    {
      'method': 'linear',
      'field': 'freq',
      'when': 0,
      'cutoff': true,
      'value': 1
    },
    {
      'method': 'assign',
      'field': 'freq',
      'when': 0.3,
      'cutoff': true,
      'value': 1
    },
    {
      'method': 'linear',
      'field': 'freq',
      'when': 0.4,
      'cutoff': true,
      'value': 0.6
    },
    {
      'method': 'linear',
      'field': 'freq',
      'when': 1,
      'cutoff': true,
      'value': 0.4
    }
  ];
  exports.fxFadeIn = [
    {
      'method': 'assign',
      'field': 'volume',
      'when': 0,
      'value': 0
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 0.999,
      'value': 1
    }
  ];
  exports.fxFadeOut = [
    {
      'method': 'assign',
      'field': 'volume',
      'when': 0,
      'value': 1
    },
    {
      'method': 'linear',
      'field': 'volume',
      'when': 0.999,
      'value': 0
    }
  ];
  exports.fxArpFast = [
    {
      'method': 'arp',
      'field': 'any',
      'when': 0,
      'value': 8
    }
  ];
  exports.fxArpSlow = [
    {
      'method': 'arp',
      'field': 'any',
      'when': 0,
      'value': 4
    }
  ];

  // Prefab waveforms.

  // See https://www.sitepoint.com/using-fourier-transforms-web-audio-api/ for how WebAudio produces sounds,
  // and how we customize waveforms.

  exports.wavSine = 'sine';
  exports.wavTriangle = 'triangle';
  exports.wavSaw = 'sawtooth';
  exports.wavSquare = 'square';

  /* ========================================================} */

}));

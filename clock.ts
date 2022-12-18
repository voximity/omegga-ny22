import fs from 'fs';
import { BrickV10, BrsV10, PS, UnrealColor, WriteSaveObject } from 'omegga';
import Plugin, { Storage, Vector } from 'omegga.plugin';

export const SEGMENTS: Record<string, number> = {
  '0': 0b1111011,
  '1': 0b1001000,
  '2': 0b0111101,
  '3': 0b1101101,
  '4': 0b1001110,
  '5': 0b1100111,
  '6': 0b1110111,
  '7': 0b1001001,
  '8': 0b1111111,
  '9': 0b1101111,
  A: 0b1011111,
  B: 0b1110110,
  C: 0b0110011,
  D: 0b1111100,
  E: 0b0110111,
  F: 0b0010111,
  G: 0b1110011,
  H: 0b1011110,
  I: 0b0010010,
  J: 0b1111000,
  K: 0b1011110, // same as H :(
  L: 0b0110010,
  M: 0b1011011, // same as N :(
  N: 0b1011011,
  O: 0b1111011,
  P: 0b0011111,
  Q: 0b1001111,
  R: 0b0010100,
  S: 0b1100111,
  T: 0b0110110,
  U: 0b1111010,
  V: 0b1110000,
  W: 0b1111010, // same as U :(
  X: 0b1011110, // same as H :(
  Y: 0b1101110,
  Z: 0b0111101,
  ' ': 0,
};

const sleep = (ms: number) =>
  new Promise((resolve, reject) => setTimeout(resolve, ms));

const importAsset = (
  path: string,
  isDigit?: boolean
): [BrsV10, BrickV10[][]] => {
  const save = OMEGGA_UTIL.brs.read(fs.readFileSync(path));
  if (save.version !== 10) throw 'bad_save_ver';

  const bounds = OMEGGA_UTIL.brick.getBounds(save);
  for (const brick of save.bricks) {
    brick.position = brick.position.map(
      (c, i) => c - bounds.center[i]
    ) as Vector;

    brick.owner_index = 0;
  }

  const digit_bricks: BrickV10[][] = [];
  if (isDigit) {
    for (let i = 0; i < 7; i++) {
      digit_bricks.push(save.bricks.filter((b) => b.color === i));
    }
  }

  return [save, digit_bricks];
};

export const [DIGIT_SAVE, DIGIT_BRICKS] = importAsset(
  'plugins/ny22/assets/digit.brs',
  true
);
export const [COLON_SAVE] = importAsset('plugins/ny22/assets/colon.brs');

DIGIT_SAVE.brick_owners = [];
for (let i = 0; i < 128; i++) {
  DIGIT_SAVE.brick_owners.push({
    name: `7seg_${i}`,
    id: '00000000-0000-0000-0000-' + i.toString(16).padStart(12, '0'),
    bricks: 0,
  });
}

COLON_SAVE.bricks.forEach(
  (b) =>
    (b.asset_name_index = DIGIT_SAVE.brick_assets.indexOf(
      COLON_SAVE.brick_assets[b.asset_name_index]
    ))
);

const promises: Record<string, (data?: string) => void> = {};

const waitForUser = (user: string) => {
  if (user in promises) return;
  return new Promise<string | undefined>((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete promises[user];
      reject('timed_out');
    }, 30_000);

    promises[user] = (data?: string) => {
      clearTimeout(timeout);
      delete promises[user];
      resolve(data);
    };
  });
};

export let clockPos: { location: Vector; orientation: string } | undefined;
export let overrideContents = false;

export const setPos = async (
  pos: { location: Vector; orientation: string },
  store: PS<Storage>
) => {
  clockPos = pos;
  await store.set('clockPos', pos);
};

export const digitFromLetter = (
  letter: string,
  props?: Partial<BrickV10>,
  offset?: Vector
): BrickV10[] => {
  if (!(letter in SEGMENTS)) throw 'no_letter';
  const flag = SEGMENTS[letter];

  const bricks = [];
  for (let i = 0; i < 7; i++) {
    if (flag & (1 << i)) {
      for (const ref of DIGIT_BRICKS[i]) {
        const brick = { ...ref, ...(props ?? {}) };
        if (offset) {
          brick.position = brick.position.map(
            (c, i) => c + offset[i]
          ) as Vector;
        }
        bricks.push(brick);
      }
    }
  }

  return bricks;
};

export const loadClockBricks = async (data: WriteSaveObject) => {
  const orientation =
    OMEGGA_UTIL.brick.BRICK_CONSTANTS.orientationMap[clockPos.orientation];

  for (let i = 0; i < data.bricks.length; i++)
    data.bricks[i] = OMEGGA_UTIL.brick.rotate(data.bricks[i], orientation);

  await Omegga.loadSaveData(data, {
    quiet: true,
    offX: clockPos.location[0],
    offY: clockPos.location[1],
    offZ: clockPos.location[2],
  });
};

let currentClock = '';
const clockAlternator = [];

const getAlternator = (n: number) => {
  const a = Number(clockAlternator[n]);
  return isNaN(a) ? 0 : a;
};

export const loadClockString = async (plugin: Plugin, str: string) => {
  const bricks = [];
  const off: Vector = [0, 0, 0];
  const deleteOwners = [];

  let i = 0;
  for (; i < str.length; i++) {
    const unchanged = currentClock[i] === str[i];
    const loff: Vector = [0, 0, 0];

    // if the digit changed...
    if (!unchanged) {
      // add the current alternation to be deleted
      deleteOwners.push(DIGIT_SAVE.brick_owners[i * 2 + getAlternator(i)].id);

      // invert the alternation
      clockAlternator[i] = !clockAlternator[i];

      // adjust the local offset based on the alternation
      loff[0] = -getAlternator(i) * 4;
    }

    const owner = i * 2 + getAlternator(i);
    if (str[i] === ':') {
      // a colon
      off[1] -= 25;

      if (!unchanged) {
        const colon = COLON_SAVE.bricks.map((src) => {
          return {
            ...src,
            position: src.position.map(
              (c, i) => c + off[i] + loff[i]
            ) as Vector,
            color: 0,
            material_index: 0,
            owner_index: owner + 1,
          };
        });

        colon.forEach((b) => bricks.push(b));
      }
      off[1] += 65;
    } else if (str[i] === ';') {
      // a blank colon
      off[1] += 40;
    } else if (str[i] === ' ') {
      // a space
      off[1] += 90;
    } else {
      if (!unchanged) {
        const digit = digitFromLetter(
          str[i].toUpperCase(),
          {
            owner_index: owner + 1,
            color: 0,
            material_index: 0,
          },
          off.map((c, i) => c + loff[i]) as Vector
        );

        digit.forEach((b) => bricks.push(b));
      }
      off[1] += 90;
    }
  }

  // clean up extra chars
  if (i < currentClock.length) {
    for (; i < currentClock.length; i++)
      Omegga.clearBricks(DIGIT_SAVE.brick_owners[i].id, true);
  }

  currentClock = str;

  const save = {
    ...DIGIT_SAVE,
    materials: [plugin.config['clock-material'] ?? 'BMC_Glow'],
    colors: [
      plugin.config['clock-color']
        ? ([
            ...plugin.config['clock-color'].split(',').map(Number),
            255,
          ] as UnrealColor)
        : [255, 255, 255, 255],
    ],
    bricks,
  } as WriteSaveObject;

  if (save.bricks.length !== 0) await loadClockBricks(save);
  for (const owner of deleteOwners) Omegga.clearBricks(owner, true);
};

export const marquee = async (plugin: Plugin, text: string) => {
  if (overrideContents) throw 'already_active';
  overrideContents = true;
  const limit = plugin.config['clock-include-days'] ? 8 : 6;

  const displaySlice = async (slice: string) => {
    let s = '';
    for (let i = 0; i < limit; i++) {
      s += slice[i] ?? ' ';
      if (i % 2 === 1) s += ';';
    }
    await loadClockString(plugin, s.replace(/;$/, ''));
  };

  if (text.length <= limit) {
    displaySlice(text);
    await sleep(5000);
    overrideContents = false;
  } else {
    displaySlice(text.slice(0, limit));
    await sleep(2000);
    for (let i = 0; i < text.length; i++) {
      displaySlice(text.slice(i, i + limit));
      await sleep(500);
    }
    for (let i = 0; i < limit; i++) {
      displaySlice(text.slice(0, i + 1).padStart(limit));
      await sleep(500);
    }
    await sleep(500);
    overrideContents = false;
  }
};

export const handleCommand =
  (plugin: Plugin) =>
  async (speaker: string, action: string, ...args: string[]) => {
    const player = Omegga.getPlayer(speaker);
    if (
      !player.isHost() &&
      !player
        .getRoles()
        .some((r) => (plugin.config['clock-authorized'] ?? []).includes(r))
    )
      return;

    try {
      if (action === 'setpos') {
        // set the clock's position

        // load the digit onto the player's clipboard
        player.loadSaveData(DIGIT_SAVE);
        Omegga.whisper(
          player,
          `Move the copied digit to the first digit on the clock.`
        );
        Omegga.whisper(
          player,
          `When you are satisfied, run <code>/clock ok</>.`
        );
        await waitForUser(speaker);

        const ghost = await player.getGhostBrick();
        currentClock = '';
        for (const owner of DIGIT_SAVE.brick_owners)
          Omegga.clearBricks(owner.id, true);
        await setPos(
          {
            location: ghost.location as Vector,
            orientation: ghost.orientation,
          },
          plugin.store
        );
        Omegga.whisper(player, 'Clock position set.');
      } else if (action === 'marquee') {
        await marquee(plugin, args.join(' '));
      } else if (action === 'clear') {
        currentClock = '';
        for (const owner of DIGIT_SAVE.brick_owners)
          Omegga.clearBricks(owner.id, true);
      } else if (action === 'ok') {
        if (speaker in promises)
          promises[speaker](args.length > 0 ? args.join(' ') : undefined);
      } else {
        Omegga.whisper(player, 'Unknown clock action <code>' + action + '</>.');
      }
    } catch (e) {
      console.error('error', e);
    }
  };

let startTime = Date.now() / 1000;

const clockUpdate = async (plugin: Plugin) => {
  if (overrideContents) return;

  const days = plugin.config['clock-include-days'] ?? false;

  let t: number;
  switch (plugin.config['clock-behavior']) {
    case 'countdown':
      t = Math.round(
        Math.max(0, plugin.config['clock-timestamp'] - Date.now() / 1000)
      );
      break;
    case 'countup':
      t = Math.round(Math.max(0, Date.now() / 1000 - startTime));
      break;
    case 'time':
    default:
      t = 0;
      break;
  }

  const dd = Math.floor((t / 86400) % 99);
  const hh = Math.floor((t / 3600) % (days ? 24 : 99));
  const mm = Math.floor((t / 60) % 60);
  const ss = t % 60;
  const col = ss % 2 === 0 ? ':' : ';';

  if (t > 0)
    await loadClockString(
      plugin,
      (days ? [dd, hh, mm, ss] : [hh, mm, ss])
        .map((s) => s.toString().padStart(2, '0'))
        .join(col)
    );
  else {
    await loadClockString(
      plugin,
      Math.round(Date.now() / 1000) % 2 === 0
        ? (days ? [0, 0, 0, 0] : [0, 0, 0])
            .map((s) => s.toString().padStart(2, '0'))
            .join(':')
        : (days ? ['  ', '  ', '  ', '  '] : ['  ', '  ', '  ']).join(':')
    );
  }
};

export const init = async (plugin: Plugin) => {
  for (const owner of DIGIT_SAVE.brick_owners)
    Omegga.clearBricks(owner.id, true);

  const pos = await plugin.store.get('clockPos');
  if (pos) {
    clockPos = pos;
    setInterval(() => clockUpdate(plugin), 1000);
  }
};

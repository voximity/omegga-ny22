import OmeggaPlugin, { OL, PS, PC, OmeggaPlayer } from 'omegga';
import * as clock from './clock';

export type Config = {
  ['clock-enable']: boolean;
  ['clock-behavior']: 'countdown' | 'countup' | 'time';
  ['clock-authorized']: string[];
  ['clock-timestamp']: number;
  ['clock-include-days']: boolean;
  ['clock-material']: string;
  ['clock-color']: string;
  ['tpinteract-enable']: boolean;
  ['tpinteract-authorized']: string[];
};
export type Storage = {
  clockPos?: { location: Vector; orientation: string };
  keys?: { [id: string]: Record<string, boolean> };
  locks?: {
    [uuid: string]: {
      key: string;
      position: number[];
      message?: string;
      error?: string;
    };
  };
};
export type Vector = [number, number, number];

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;
  keys: Storage['keys'];
  locks: Storage['locks'];

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  teleport = (target: string, position: Vector, keepVelocity?: boolean) => {
    this.omegga.writeln(
      `Chat.Command /TP "${target.replace(/"/g, '\\"')}" ${position.join(
        ' '
      )} ${keepVelocity ?? false ? '1' : '0'}`
    );
  };

  grantKey = async (player: { name: string; id: string }, key: string) => {
    (this.keys[player.id] ??= {})[key] = true;
    await this.store.set('keys', this.keys);
    console.log(`Granted key "${key}" to ${player.name}`);
  };

  newLock = async (key: string, position: number[]) => {
    const id = OMEGGA_UTIL.uuid.random();
    this.locks[id] = { key, position };
    await this.store.set('locks', this.locks);
    return id;
  };

  tpiAuth = (player: OmeggaPlayer) =>
    player.isHost() ||
    player
      .getRoles()
      .some((r) => (this.config['tpinteract-authorized'] ?? []).includes(r));

  getLock = (id: string): [string, Storage['locks'][string]] | [] => {
    let lockId: string;
    let lock: Storage['locks'][string];

    if (id in this.locks) lock = this.locks[(lockId = id)];
    else {
      [lockId, lock] =
        Object.entries(this.locks).find(([i]) =>
          i.startsWith(id.toLowerCase())
        ) ?? [];

      if (!lock) {
        return [];
      }
    }

    return [lockId, lock];
  };

  async init() {
    const registeredCommands = [];

    if (this.config['clock-enable']) {
      clock.init(this);
      this.omegga.on('cmd:clock', clock.handleCommand(this));
      registeredCommands.push('clock');
    }

    if (this.config['tpinteract-enable']) {
      this.keys = (await this.store.get('keys')) ?? {};
      this.locks = (await this.store.get('locks')) ?? {};

      this.omegga.on('cmd:tpinteract', async (speaker: string) => {
        const player = this.omegga.getPlayer(speaker);
        if (!this.tpiAuth(player)) return;

        const pos = await player.getPosition();

        this.omegga.whisper(
          player,
          `<color="ff0">Please insert the following into the <b>Interact</> component's <b>Write to Console</i> field</>`
        );
        this.omegga.whisper(player, `<code>tp:${pos.map(Math.round)}</>`);
      });

      this.omegga.on(
        'cmd:wipekeys',
        async (speaker: string, confirm: string) => {
          const player = this.omegga.getPlayer(speaker);
          if (!this.tpiAuth(player)) return;

          if ((confirm ?? '').toLowerCase() !== 'yes-i-want-to-do-this')
            return this.omegga.whisper(
              player,
              `<color="f00">Please pass <code>yes-i-want-to-do-this</> to confirm.</>`
            );

          this.keys = {};
          await this.store.set('keys', this.keys);
          this.omegga.whisper(player, 'Wiped all keys.');
        }
      );

      this.omegga.on(
        'cmd:locks',
        async (speaker: string, action: string, ...args: string[]) => {
          const player = this.omegga.getPlayer(speaker);
          if (!this.tpiAuth(player)) return;

          if (action === 'new') {
            // new key
            if (!args[0]) {
              this.omegga.whisper(
                player,
                `<color="f00">Please specify a key name that the lock will be unlocked with.</>`
              );
              return;
            }

            const name = args[0].trim();
            const pos = (await player.getPosition()).map(Math.round);
            const id = await this.newLock(name, pos);
            this.omegga.whisper(
              player,
              `Created new lock <code>${name}</>. (<code>${id}</>)`
            );

            // give player a brick with the component
            await player.loadSaveData(
              {
                brick_assets: ['PB_DefaultBrick'],
                bricks: [
                  {
                    position: [0, 0, 0],
                    size: [5, 5, 6],
                    asset_name_index: 0,
                    owner_index: 0,
                    color: [255, 255, 255],
                    components: {
                      BCD_Interact: {
                        bPlayInteractSound: true,
                        Message: '',
                        ConsoleTag: 'tplock:' + id,
                      },
                    },
                  },
                ],
              },
              { quiet: true }
            );
          } else if (
            action === 'delete' ||
            action === 'remove' ||
            action === 'rm'
          ) {
            // remove a lock
            if (!args[0]) {
              this.omegga.whisper(
                player,
                `<color="f00">Please specify the start of a lock ID to remove it.</>`
              );
              return;
            }

            const [lockId, lock] = this.getLock(args[0]);
            if (!lock)
              return this.omegga.whisper(
                player,
                `<color="f00">No lock found with that ID.</>`
              );

            delete this.locks[lockId];
            await this.store.set('locks', this.locks);

            this.omegga.whisper(player, `Deleted lock <code>${lockId}</>.`);
          } else if (action === 'message') {
            // remove a lock
            if (!args[0]) {
              this.omegga.whisper(
                player,
                `<color="f00">Please specify the start of a lock ID.</>`
              );
              return;
            }

            const [lockId, lock] = this.getLock(args[0]);
            if (!lock)
              return this.omegga.whisper(
                player,
                `<color="f00">No lock found with that ID.</>`
              );

            lock.message = args.slice(1).join(' ');
            await this.store.set('locks', this.locks);

            this.omegga.whisper(player, `Message set.`);
          } else if (action === 'error') {
            // remove a lock
            if (!args[0]) {
              this.omegga.whisper(
                player,
                `<color="f00">Please specify the start of a lock ID.</>`
              );
              return;
            }

            const [lockId, lock] = this.getLock(args[0]);
            if (!lock)
              return this.omegga.whisper(
                player,
                `<color="f00">No lock found with that ID.</>`
              );

            lock.error = args.slice(1).join(' ');
            await this.store.set('locks', this.locks);

            this.omegga.whisper(player, `Message set.`);
          } else if (action === 'key') {
            if (!args[0])
              return this.omegga.whisper(
                player,
                `<color="f00">Please specify a key to create a brick for.</>`
              );

            await player.loadSaveData(
              {
                brick_assets: ['PB_DefaultBrick'],
                bricks: [
                  {
                    position: [0, 0, 0],
                    size: [5, 5, 6],
                    asset_name_index: 0,
                    owner_index: 0,
                    color: [255, 255, 255],
                    components: {
                      BCD_Interact: {
                        bPlayInteractSound: true,
                        Message: '',
                        ConsoleTag: 'tpkey:' + args[0],
                      },
                    },
                  },
                ],
              },
              { quiet: true }
            );
          } else if (action === 'list' || action === 'ls' || !action) {
            // list of locks
            this.omegga.whisper(player, `<b>List of locks:</>`);
            for (const id in this.locks) {
              const lock = this.locks[id];
              this.omegga.whisper(
                player,
                `- Unlocked by key <code>${lock.key}</> (${id})`
              );
            }
          }
        }
      );

      this.omegga.on('interact', async (interaction) => {
        // grant key
        if (interaction.message.startsWith('tpkey:')) {
          const name = interaction.message.substring(6);
          await this.grantKey(interaction.player, name);
          return;
        }

        // locked teleport
        if (interaction.message.startsWith('tplock:')) {
          const id = interaction.message.substring(7);
          const lock = this.locks[id];
          if (!lock) {
            this.omegga.middlePrint(
              interaction.player.id,
              `<color="f00">No lock associated with this ID!</><br><code>${id}</>`
            );
            return;
          }

          if (!this.keys[interaction.player.id]?.[lock.key]) {
            this.omegga.middlePrint(
              interaction.player.id,
              lock.error ??
                '<color="f00">You don\'t have access to this teleport!</>'
            );
            return;
          }

          if (lock.message) {
            this.omegga.middlePrint(interaction.player.id, lock.message);
          }

          this.teleport(
            interaction.player.name,
            lock.position.slice(0, 3) as Vector,
            Boolean(lock.position[3])
          );

          return;
        }

        // regular teleport
        if (interaction.message.startsWith('tp:')) {
          const target = interaction.message
            .substring(3)
            .split(',')
            .map((n) => Number(n.trim()))
            .filter((n) => n);
          if (!target || target.length < 3) return;

          this.teleport(
            interaction.player.name,
            target.slice(0, 3) as Vector,
            Boolean(target[3])
          );
          return;
        }
      });

      registeredCommands.push('tpinteract', 'locks', 'wipekeys');
    }

    return { registeredCommands };
  }

  async stop() {}
}

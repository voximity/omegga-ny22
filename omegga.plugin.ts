import OmeggaPlugin, { OL, PS, PC } from 'omegga';
import * as clock from './clock';

export type Config = {
  ['clock-enable']: boolean;
  ['clock-timestamp']: number;
  ['clock-include-days']: boolean;
  ['clock-material']: string;
  ['clock-color']: string;
  ['tpinteract-enable']: boolean;
};
export type Storage = {
  clockPos?: { location: Vector; orientation: string };
};
export type Vector = [number, number, number];

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

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

  async init() {
    const registeredCommands = [];

    if (this.config['clock-enable']) {
      clock.init(this);
      this.omegga.on('cmd:clock', clock.handleCommand(this));
      registeredCommands.push('clock');
    }

    if (this.config['tpinteract-enable']) {
      this.omegga.on('cmd:tpinteract', async (speaker: string) => {
        const player = this.omegga.getPlayer(speaker);
        const pos = await player.getPosition();

        this.omegga.whisper(
          player,
          `<color="ff0">Please insert the following into the <b>Interact</> component's <b>Write to Console</i> field</>`
        );
        this.omegga.whisper(player, `<code>tp:${pos.map(Math.round)}</>`);
      });

      this.omegga.on('interact', (interaction) => {
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
        }
      });

      registeredCommands.push('tpinteract');
    }

    return { registeredCommands };
  }

  async stop() {}
}

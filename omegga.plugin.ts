import OmeggaPlugin, { OL, PS, PC } from "omegga";

type Config = { foo: string };
type Storage = { bar: string };

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  async init() {
    this.omegga.on("cmd:tpinteract", async (speaker: string) => {
      const player = this.omegga.getPlayer(speaker);
      const pos = await player.getPosition();

      this.omegga.whisper(
        player,
        `<color="ff0">Please insert the following into the <b>Interact</> component's <b>Write to Console</i> field</>`
      );
      this.omegga.whisper(player, `<code>tp:${pos.map(Math.round)}</>`);
    });

    this.omegga.on("interact", (interaction) => {
      if (interaction.message.startsWith("tp:")) {
        const target = interaction.message
          .substring(3)
          .split(",")
          .map((n) => Number(n.trim()))
          .filter((n) => n);
        if (!target || target.length < 3) return;

        this.omegga.writeln(
          `Chat.Command /TP "${interaction.player.name}" ${target
            .slice(0, 3)
            .join(" ")} ${target[3] ?? "1"}`
        );
      }
    });

    return { registeredCommands: ["tpinteract"] };
  }

  async stop() {}
}

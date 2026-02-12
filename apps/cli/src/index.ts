#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { watchCommand } from "./commands/watch.js";
import { ciCommand } from "./commands/ci.js";

const program = new Command();

program.name("perceo").description("Intelligent regression testing through multi-agent simulation").version("0.1.0");

program.addCommand(initCommand);
program.addCommand(watchCommand);
program.addCommand(ciCommand);

program.parse();

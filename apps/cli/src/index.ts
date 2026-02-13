#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { analyzeCommand } from "./commands/analyze.js";
import { keysCommand } from "./commands/keys.js";

const program = new Command();

program.name("perceo").description("Intelligent regression testing through multi-agent simulation").version("0.1.0");

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(initCommand);
program.addCommand(analyzeCommand);
program.addCommand(keysCommand);

program.parse();

import { openDatabase } from "../src/db";
import { Protocol } from "../src/engine/protocol";
import { seedDemo } from "../src/engine/seed";
console.log(seedDemo(new Protocol(openDatabase())));

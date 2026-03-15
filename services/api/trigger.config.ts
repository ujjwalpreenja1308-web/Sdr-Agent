import { defineConfig } from '@trigger.dev/sdk/v3'

export default defineConfig({
  project: 'proj_zfoypzoqepezuqrmuahm',
  runtime: 'node',
  dirs: ['./src/trigger'],
  tsconfig: './tsconfig.trigger.json',
  maxDuration: 300,
})

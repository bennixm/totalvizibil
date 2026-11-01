import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const COMPANY_ID = 'dcaec9bd-ca19-4acb-b8ae-7de26979695c' // AutoDetail Expert Cluj
const API_BASE = 'https://dev.totalvizibil.ro/api/v1'
const SLUG = 'autodetail-expert-cluj'

const FILES = {
  'index.html': `<!doctype html>
<html lang="ro">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AutoDetail Expert Cluj — Detailing auto premium în Cluj-Napoca</title>
    <meta name="description" content="AutoDetail Expert Cluj oferă servicii de detailing auto premium: polish, protecție ceramică și curățare interior în Cluj-Napoca." />
    <meta property="og:title" content="AutoDetail Expert Cluj" />
    <meta property="og:description" content="Detailing auto premium în Cluj-Napoca." />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  'src/App.vue': `<template>
  <Hero />
  <Services />
  <Contact />
</template>

<script setup lang="ts">
import Hero from './components/Hero.vue'
import Services from './components/Services.vue'
import Contact from './components/Contact.vue'
</script>
`,
  'src/components/Hero.vue': `<template>
  <header class="hero">
    <h1>AutoDetail Expert Cluj</h1>
    <p>Detailing auto premium în Cluj-Napoca</p>
  </header>
</template>

<script setup lang="ts"></script>

<style scoped>
.hero { min-height: 60vh; display: flex; flex-direction: column; justify-content: center; align-items: center; background: #0f172a; color: #fff; text-align: center; gap: 1rem; }
</style>
`,
  'src/components/Services.vue': `<template>
  <section class="services" id="servicii">
    <h2>Serviciile noastre</h2>
    <ul>
      <li>Polish &amp; corecție vopsea</li>
      <li>Protecție ceramică</li>
      <li>Curățare interior premium</li>
    </ul>
  </section>
</template>

<script setup lang="ts"></script>

<style scoped>
.services { padding: 4rem 2rem; max-width: 960px; margin: 0 auto; }
</style>
`,
  'src/components/Contact.vue': `<template>
  <section class="contact" id="contact">
    <h2>Contact</h2>
    <form @submit.prevent="submit">
      <input v-model="name" placeholder="Nume" />
      <input v-model="email" placeholder="Email" />
      <textarea v-model="message" placeholder="Mesaj"></textarea>
      <button type="submit" :disabled="sending">{{ sending ? 'Se trimite...' : 'Trimite' }}</button>
      <p v-if="sent">Mulțumim! Te vom contacta în curând.</p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const API_BASE = '${API_BASE}'
const name = ref('')
const email = ref('')
const message = ref('')
const sending = ref(false)
const sent = ref(false)

async function submit() {
  sending.value = true
  try {
    await fetch(\`\${API_BASE}/public/companies/${SLUG}/lead\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'form', name: name.value, email: email.value, message: message.value }),
    })
    sent.value = true
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.contact { padding: 4rem 2rem; max-width: 640px; margin: 0 auto; }
form { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
`,
}

async function main() {
  const project = await prisma.proV2Project.findUnique({ where: { companyId: COMPANY_ID } })
  if (!project) throw new Error('No PRO V2 project for this company — run getOrCreateProject first')

  for (const [path, content] of Object.entries(FILES)) {
    await prisma.proV2File.upsert({
      where: { projectId_path: { projectId: project.id, path } },
      update: { content },
      create: { projectId: project.id, path, content },
    })
  }
  const files = await prisma.proV2File.findMany({ where: { projectId: project.id }, select: { path: true } })
  console.log(`Project now has ${files.length} files:`, files.map((f) => f.path).join(', '))
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

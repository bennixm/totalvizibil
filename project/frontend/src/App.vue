<script setup>
import Navbar from './components/Navbar.vue'
import Footer from './components/Footer.vue'
</script>

<template>
  <div id="app">
    <Navbar />
    <main>
      <router-view />
    </main>
    <Footer />
  </div>
</template>

<style scoped>
#app {
  font-family: 'Inter', sans-serif;
  color: #333;
}
main {
  padding: 1rem;
}
</style>

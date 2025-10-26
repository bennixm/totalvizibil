<template>
  <nav class="navbar">
    <router-link to="/">Acasă</router-link>
    <router-link to="/about">Despre</router-link>
    <router-link to="/contact">Contact</router-link>
  </nav>
</template>

<style scoped>
.navbar {
  display: flex;
  gap: 1rem;
  background: #eee;
  padding: 1rem;
}
.router-link-active {
  font-weight: bold;
}
</style>

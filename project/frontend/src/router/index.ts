import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import Home from '../views/Home.vue'
import About from '../views/About.vue'
import Contact from '../views/Contact.vue'
import NotFound from '../views/NotFound.vue'
import Layout from '@/components/Layout.vue'

import { i18n } from '@/i18n'
import type { SupportedLang } from '@/types/i18n'

const supportedLanguages: SupportedLang[] = ['en','de','ro']

const routes: RouteRecordRaw[] = [
    {
        path: '/:lang(en|de|ro)?',
        component: Layout,
        children: [
            { path: '', name: 'Home', component: Home },
            { path: 'about', name: 'About', component: About },
            { path: 'contact', name: 'Contact', component: Contact },
            { path: ':pathMatch(.*)*', name: 'NotFound', component: NotFound },
        ]
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

router.beforeEach((to, from, next) => {
    const lang = to.params.lang as SupportedLang | undefined
    if (!lang || !supportedLanguages.includes(lang)) {
        const defaultLang: SupportedLang = 'ro'
        const path = to.fullPath.replace(/^\/(en|de|ro)/,'')
        return next({ path: `/${defaultLang}${path}` })
    }
    i18n.global.locale.value = lang
    next()
})

export default router

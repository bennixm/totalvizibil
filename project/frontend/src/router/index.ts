import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import Home from '../views/Home.vue'
import About from '../views/About.vue'
import Contact from '../views/Contact.vue'
import NotFound from '../views/NotFound.vue'
import Layout from '@/components/Layout.vue'

import { i18n } from '@/i18n'
import type { SupportedLang } from '@/types/i18n'

const supportedLanguages: SupportedLang[] = ['en', 'de', 'ro']

const routes: RouteRecordRaw[] = [
    {
        path: '/:lang(en|de|ro)?',
        component: Layout,
        children: [
            { path: '', name: 'Home', component: Home },
            { path: 'about', name: 'About', component: About },
            { path: 'contact', name: 'Contact', component: Contact },
            { path: ':pathMatch(.*)*', name: 'NotFound', component: NotFound },
        ],
    },
]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

function getStoredLang(): SupportedLang {
    const stored = localStorage.getItem('lang') as SupportedLang | null
    if (stored && supportedLanguages.includes(stored)) return stored
    return 'ro'
}

router.beforeEach((to, from, next) => {
    let lang = to.params.lang as SupportedLang | undefined

    if (!lang || !supportedLanguages.includes(lang)) {
        lang = getStoredLang()
        const path = to.fullPath.replace(/^\/(en|de|ro)/, '')
        return next({ path: `/${lang}${path}` })
    }

    i18n.global.locale.value = lang

    localStorage.setItem('lang', lang)

    next()
})

export default router

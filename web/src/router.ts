import {createRouter, createWebHashHistory} from 'vue-router'

// Hash routes (#/name/alice.znn), so one relative build serves from GitHub
// Pages, a domain's root and a gateway's /zns/ with no rewrite rule, and
// so the `external_url` each token carries on chain always lands.
export const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: (to, from, saved) => saved ?? (to.path === from.path ? false : {top: 0}),
  routes: [
    {path: '/', name: 'home', component: () => import('./pages/HomePage.vue')},
    {path: '/name/:name', name: 'name', component: () => import('./pages/NamePage.vue')},
    {path: '/address/:address', name: 'address', component: () => import('./pages/AddressPage.vue')},
    {path: '/names', name: 'mine', component: () => import('./pages/MyNamesPage.vue')},
    {path: '/explore', name: 'explore', component: () => import('./pages/ExplorePage.vue')},
    {path: '/about', name: 'about', component: () => import('./pages/AboutPage.vue')},
    {path: '/admin', name: 'admin', component: () => import('./pages/AdminPage.vue')},
    {path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./pages/NotFoundPage.vue')},
  ],
})

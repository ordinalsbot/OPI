module.exports = {
    apps: [{
        name: "main_index",
        script: "./modules/main_index/index.js",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "4G"
    },{
        name: "brc20_index",
        script: "./modules/brc20_index/index.js",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "4G"
    }]
};
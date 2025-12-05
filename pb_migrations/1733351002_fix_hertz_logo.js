/// <reference path="../pb_data/types.d.ts" />
// Migration to fix Hertz Car Sales logo
migrate((app) => {
    const collection = app.findCollectionByNameOrId("dealers")
    
    // Find the Hertz dealer by code
    const hertzDealer = app.findFirstRecordByData("dealers", "code", "0001")
    
    if (hertzDealer) {
        // Update with a working Hertz logo (using a reliable CDN source)
        hertzDealer.set("logo", "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Hertz_logo.svg/200px-Hertz_logo.svg.png")
        app.save(hertzDealer)
        console.log("Updated Hertz Car Sales logo")
    } else {
        console.log("Hertz dealer not found - skipping logo update")
    }
}, (app) => {
    // Revert migration - restore original logo
    const hertzDealer = app.findFirstRecordByData("dealers", "code", "0001")
    if (hertzDealer) {
        hertzDealer.set("logo", "https://www.hertzcarbuying.com/content/dam/hertz-car-sales/images/logos/hertz-car-sales-logo.svg")
        app.save(hertzDealer)
    }
})

// Runner fixture: the v0.7.12 bug in miniature. Prints "passed", then a
// forgotten interval keeps Node alive forever.
console.log("leak fixture passed");
setInterval(() => {}, 400);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const run = async (label, url) => {
    const p = new client_1.PrismaClient({ datasources: { db: { url } } });
    const rows = {
        users: await p.user.count(),
        courses: await p.course.count(),
        lessons: await p.lesson.count(),
        tasks: await p.lessonTask.count(),
        questions: await p.question.count(),
        progress: await p.lessonTaskProgress.count(),
        trapState: await p.lessonTaskProgress.count({ where: { NOT: { trapHunterState: { equals: client_1.Prisma.DbNull } } } }),
    };
    console.log(label, JSON.stringify(rows));
    await p.$disconnect();
};
(async () => {
    const dotenv = require('dotenv');
    const dev = dotenv.parse(require('fs').readFileSync('.env'));
    const test = dotenv.parse(require('fs').readFileSync('.env.test'));
    await run('DEV :', dev.DATABASE_URL);
    await run('TEST:', test.DATABASE_URL);
})();
//# sourceMappingURL=dbcheck.tmp.js.map
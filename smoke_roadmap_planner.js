"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const config_1 = require("@nestjs/config");
const gemini_roadmap_planner_provider_1 = require("./src/placement/roadmap/gemini-roadmap-planner.provider");
const config = new config_1.ConfigService();
const provider = new gemini_roadmap_planner_provider_1.GeminiRoadmapPlannerProvider(config);
const candidates = [
    {
        resourceType: 'COURSE',
        id: 'course-grammar-1',
        pillar: 'GRAMMAR',
        level: 'A1',
        sortKey: 1,
        title: 'Ngữ pháp cơ bản',
        description: 'Khóa học ngữ pháp nền tảng cho người mới bắt đầu.',
        suitableGoals: ['FOUNDATION', 'GENERAL_ENGLISH', 'REGULAR_PRACTICE'],
    },
    {
        resourceType: 'VOCAB_LIBRARY',
        id: 'vocab-lib-1',
        pillar: 'VOCABULARY',
        level: 'A1',
        sortKey: 1,
        title: '1000 Từ Tiếng Anh Thông Dụng',
        description: 'Thư viện 1000 từ vựng thông dụng nhất.',
        suitableGoals: ['FOUNDATION', 'GENERAL_ENGLISH', 'REGULAR_PRACTICE'],
    },
    {
        resourceType: 'LISTENING_CATEGORY',
        id: 'listening-cat-1',
        pillar: 'LISTENING',
        level: 'A1',
        sortKey: 1,
        title: 'Daily Conversations',
        description: 'Các đoạn hội thoại đời thường cho người mới bắt đầu.',
        suitableGoals: ['FOUNDATION', 'GENERAL_ENGLISH', 'REGULAR_PRACTICE'],
    },
];
const request = {
    goal: 'FOUNDATION',
    estimatedLevel: 'A2',
    levelSource: 'TEST_GRADED',
    sectionScores: { grammar: 25, vocabulary: 50, listening: 25 },
    candidates,
};
provider
    .plan(request)
    .then((result) => {
    console.log('MODEL USED:', provider.model);
    console.log(JSON.stringify(result, null, 2));
})
    .catch((err) => {
    console.error('PLANNING FAILED:', err);
    process.exitCode = 1;
});
//# sourceMappingURL=smoke_roadmap_planner.js.map
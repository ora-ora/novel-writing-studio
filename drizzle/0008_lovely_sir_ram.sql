ALTER TABLE `projects` ADD `story_bible` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `story_bible`=trim(
  CASE WHEN `mainline`<>'' THEN '# 故事主线'||char(10)||`mainline`||char(10)||char(10) ELSE '' END ||
  CASE WHEN `premise`<>'' THEN '# 世界与核心冲突'||char(10)||`premise`||char(10)||char(10) ELSE '' END ||
  CASE WHEN `important_notes`<>'' THEN '# 重要提示'||char(10)||`important_notes`||char(10)||char(10) ELSE '' END ||
  COALESCE((SELECT '# 人物'||char(10)||group_concat('## '||`name`||char(10)||
    CASE WHEN `role`<>'' THEN '身份：'||`role`||char(10) ELSE '' END||
    CASE WHEN `goal`<>'' THEN '目标：'||`goal`||char(10) ELSE '' END||
    CASE WHEN `traits`<>'' THEN '性格：'||`traits`||char(10) ELSE '' END||
    CASE WHEN `relationships`<>'' THEN '关系：'||`relationships`||char(10) ELSE '' END||
    CASE WHEN `secret`<>'' THEN '秘密：'||`secret`||char(10) ELSE '' END||
    CASE WHEN `arc`<>'' THEN '成长：'||`arc`||char(10) ELSE '' END||
    CASE WHEN `from_chapter` IS NOT NULL THEN '适用章节：'||`from_chapter`||COALESCE('—'||`until_chapter`,' 起')||char(10) ELSE '' END,char(10))||char(10)||char(10)
    FROM `characters` WHERE `project_id`=`projects`.`id`), '') ||
  COALESCE((SELECT '# 其他设定'||char(10)||group_concat('## '||`category`||char(10)||
    CASE WHEN `from_chapter` IS NOT NULL THEN '适用章节：'||`from_chapter`||COALESCE('—'||`until_chapter`,' 起')||char(10) ELSE '' END||`content`,char(10)||char(10))
    FROM `lore_cards` WHERE `project_id`=`projects`.`id`), '')
) WHERE `story_bible`='' AND `workspace_id`<>'legacy';

UPDATE `departamentos`
SET `code` = '05'
WHERE `code` = '06'
	AND `name` = 'ANTIOQUIA'
	AND NOT EXISTS (SELECT 1 FROM `departamentos` WHERE `code` = '05');
--> statement-breakpoint
DELETE FROM `departamentos`
WHERE `code` = '06'
	AND `name` = 'ANTIOQUIA'
	AND EXISTS (SELECT 1 FROM `departamentos` WHERE `code` = '05');

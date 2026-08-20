-- Общее должно быть видно из другой школы.
--
-- Все таблицы продукта живут по границе своей школы, и это правильно ровно до
-- того момента, когда содержимое открывают наружу. Курс, открытый коллеге из
-- соседней школы, лежит в чужом tenant: строчная политика отсекала его раньше,
-- чем функция успевала спросить, кому он открыт, — и общий каталог оставался
-- пустым при верно проставленных доступах.
--
-- Порядок здесь тот же, что уже принят для галереи: на чтение строк политика не
-- решает ничего, решает функция с SECURITY DEFINER, которая знает, кто
-- спрашивает и кому открыто. Запись остаётся привязанной к своей школе.
--
-- Приватное этим не задевается: наружу открывается только то, у чего уровень
-- доступа выше «только мне».

DROP POLICY IF EXISTS courses_shared_read ON courses;
CREATE POLICY courses_shared_read ON courses
    FOR SELECT USING (visibility <> 'private');

DROP POLICY IF EXISTS teacher_assignments_shared_read ON teacher_assignments;
CREATE POLICY teacher_assignments_shared_read ON teacher_assignments
    FOR SELECT USING (visibility <> 'private');

-- Состав курса и список тех, кому открыто, читаются вместе с самим курсом:
-- решение принимает функция, а не строка.
DROP POLICY IF EXISTS course_items_visible ON course_items;
DROP POLICY IF EXISTS course_items_read ON course_items;
CREATE POLICY course_items_read ON course_items FOR SELECT USING (true);
DROP POLICY IF EXISTS course_items_write ON course_items;
CREATE POLICY course_items_write ON course_items
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id));

DROP POLICY IF EXISTS content_shares_visible ON content_shares;
DROP POLICY IF EXISTS content_shares_read ON content_shares;
CREATE POLICY content_shares_read ON content_shares FOR SELECT USING (true);
DROP POLICY IF EXISTS content_shares_write ON content_shares;
CREATE POLICY content_shares_write ON content_shares
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

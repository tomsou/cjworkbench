# -*- coding: utf-8 -*-
# Generated by Django 1.11.17 on 2018-12-14 15:48
from __future__ import unicode_literals

import django.contrib.postgres.fields
from django.db import migrations, models
import django.db.models.deletion
import django.db.models.manager


class Migration(migrations.Migration):

    dependencies = [
        ('server', '0007_deletetabcommand'),
    ]

    operations = [
        migrations.CreateModel(
            name='ReorderTabsCommand',
            fields=[
                ('delta_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='server.Delta')),
                ('old_order', django.contrib.postgres.fields.ArrayField(base_field=models.IntegerField(), size=None)),
                ('new_order', django.contrib.postgres.fields.ArrayField(base_field=models.IntegerField(), size=None)),
            ],
            options={
                'abstract': False,
            },
            bases=('server.delta',),
            managers=[
                ('objects', django.db.models.manager.Manager()),
                ('base_objects', django.db.models.manager.Manager()),
            ],
        ),
    ]
